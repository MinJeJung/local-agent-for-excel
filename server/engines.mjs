// 엔진 실행기: 사용자의 claude·codex CLI를 사용자 환경 그대로 실행하고, 출력 이벤트를 작업창용 이벤트로 바꾼다.
// 원칙: 사용자 설정·스킬·MCP를 막지 않는다. excel MCP만 추가한다.
import { spawn } from "node:child_process";
import readline from "node:readline";

export const SYSTEM_PROMPT = `너는 사용자의 Microsoft Excel 작업창(Local Agent for Excel) 안에서 실행 중이다.
- 결과물은 파일을 새로 만들지 말고 열려 있는 통합 문서에 excel 도구(mcp excel)로 직접 쓴다. 사용자가 파일을 요청한 경우만 예외다.
- 메시지 앞의 [Excel 상황]에 시트 목록, 사용 범위, 표, 차트, 선택 범위 값이 들어 있다. 이것으로 충분하면 get_workbook_info나 read_range를 다시 부르지 않는다. 주소는 '시트!A1' 형식을 쓴다.
- 속도가 중요하다. 도구를 부르기 전에 계획을 설명하지 않는다. 여러 작업은 batch 하나로 묶어 보낸다. 도구가 성공을 돌려주면 다시 읽어 확인하지 않는다.
- 전용 도구가 없는 작업(정렬, 필터, 행·열 삽입·삭제, 조건부 서식, 시트 복사 등)은 run_script로 처리한다. 셸이나 AppleScript로 Excel을 조작하지 않는다.
- 계산 결과는 가능하면 수식으로 넣는다. 큰 데이터는 write_range 한 번에 쓴다.
- 사용자의 스킬, MCP, CLI, 웹 검색을 자유롭게 써서 자료를 모은 뒤 결과를 시트에 정리한다.
- 표 머리글은 굵게, 숫자는 표시 형식을 맞추고, 필요하면 표와 차트를 만든다.
- 답변은 한국어로 짧게, 무엇을 어느 범위에 썼는지 알린다.`;

const cellText = (v) => { const s = v === null || v === undefined ? "" : String(v); return s.length > 40 ? s.slice(0, 40) + "…" : s; };

export function contextLine(ctx) {
  if (!ctx) return "";
  const lines = [];
  const head = [];
  if (ctx.activeSheet) head.push(`활성 시트: ${ctx.activeSheet}`);
  if (ctx.selection) head.push(`선택 범위: ${ctx.selection}`);
  if (head.length) lines.push(head.join(", "));
  if (ctx.sheets?.length) {
    lines.push("시트: " + ctx.sheets.map((s) => {
      const bits = [s.usedRange ? s.usedRange.split("!").pop() : "빈 시트"];
      if (s.tables?.length) bits.push(`표 ${s.tables.join("·")}`);
      if (s.charts?.length) bits.push(`차트 ${s.charts.length}개`);
      if (s.hidden) bits.push("숨김");
      return `${s.name}(${bits.join(", ")})`;
    }).join(" | "));
  }
  if (ctx.preview?.length) {
    lines.push(`선택 범위 값${ctx.previewTruncated ? " (앞부분만)" : ""}:`);
    for (const row of ctx.preview) lines.push(row.map(cellText).join("\t"));
  }
  return lines.length ? `[Excel 상황]\n${lines.join("\n")}\n\n` : "";
}

function classify(name, input = {}) {
  if (name.startsWith("mcp__excel__")) return { kind: "excel", label: name.slice(12) };
  if (name.startsWith("mcp__")) {
    const [, server, ...rest] = name.split("__");
    return { kind: "mcp", label: `${server} · ${rest.join("__")}` };
  }
  if (name === "Skill") return { kind: "skill", label: input.skill || input.command || "skill" };
  if (name === "Bash") return { kind: "cli", label: String(input.command || "").slice(0, 80) };
  if (name === "Task" || name === "Agent") return { kind: "agent", label: input.description || input.subagent_type || name };
  if (name === "WebSearch" || name === "WebFetch") return { kind: "web", label: input.query || input.url || name };
  return { kind: "tool", label: name };
}

const brief = (v, n = 400) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : s;
};

function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  return JSON.stringify(content);
}

// 구독 로그인만 쓴다. 환경에 API 키나 게이트웨이 주소가 있으면 CLI가 구독 대신 그쪽으로 가므로 기본으로 뺀다.
// (launchctl setenv로 로컬 프록시를 가리키는 경우도 있다) API 키를 쓰려면 config.json에 allowApiKey: true
const CLAUDE_STRIP = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_BASE_URL", "CLAUDE_AGENT_API_BASE_URL", "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];
const CODEX_STRIP = ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"];
export function engineEnv(engine, cfg) {
  const out = { ...cfg.env };
  if (!cfg.allowApiKey) for (const k of engine === "codex" ? CODEX_STRIP : CLAUDE_STRIP) delete out[k];
  if (engine === "codex") out.LOCALXL_TOKEN = cfg.token;
  return out;
}

// ── Claude Code (상주 프로세스) ──
// 프로세스를 미리 띄워 두고 대화마다 stdin으로 메시지를 보낸다. 매번 새로 띄우면 MCP 연결에 5~8초가 든다.
export class ClaudeSession {
  constructor({ cfg, mcpConfigPath, resume, opts = {}, log = () => {} }) {
    Object.assign(this, { cfg, mcpConfigPath, opts, log, sessionId: resume || null });
    this.emit = null; this.busy = false; this.dead = false; this.err = ""; this.costSeen = 0; this.lastUsed = Date.now();
    const args = [
      "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--mcp-config", mcpConfigPath, "--append-system-prompt", SYSTEM_PROMPT, "--allowedTools", "mcp__excel,WebSearch,WebFetch", // 비대화 모드라 묻지 못하는 웹 검색은 미리 허용 (사용자 deny 규칙은 그대로 적용)
    ];
    if (this.sessionId) args.push("--resume", this.sessionId);
    const model = opts.model || cfg.claudeModel, effort = opts.effort || cfg.claudeEffort;
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    if (cfg.claudePermissionMode) args.push("--permission-mode", cfg.claudePermissionMode);
    this.child = spawn(cfg.claudeBin, args, { cwd: cfg.workdir, env: engineEnv("claude", cfg), detached: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", (d) => { this.err = (this.err + d.toString()).slice(-8000); });
    this.child.on("error", (e) => this.end(-1, `실행 실패: ${e.message}`));
    this.child.on("close", (code, signal) => this.end(code, signal ? `종료 신호 ${signal}` : null));
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      this.handle(ev);
    });
  }

  get alive() { return !this.dead && !this.killing; }

  send(text, emit) {
    this.emit = emit; this.busy = true; this.streamed = false; this.interrupted = false; this.lastUsed = Date.now();
    this.write({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
  }

  write(obj) { try { this.child.stdin.write(JSON.stringify(obj) + "\n"); } catch {} }

  // 진행 중인 차례만 멈춘다. 응답이 없으면 프로세스를 끝낸다 (다음 질문 때 이어서 다시 띄운다).
  interrupt() {
    if (!this.busy) return;
    this.interrupted = true;
    this.write({ type: "control_request", request_id: `int-${Date.now()}`, request: { subtype: "interrupt" } });
    clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => { if (this.busy) this.kill(); }, 4000);
  }

  // SIGTERM 후 3초 안에 끝나지 않으면 SIGKILL. 끝내는 중인 프로세스는 다시 쓰지 않는다 (alive=false)
  kill() {
    if (this.dead || this.killing) return;
    this.killing = true;
    killTree(this.child, () => this.dead);
  }

  finishTurn(ev) {
    clearTimeout(this.killTimer);
    this.busy = false;
    const emit = this.emit; this.emit = null;
    if (emit) { if (ev) emit(ev); emit({ type: "exit", code: 0 }); }
  }

  end(code, why) {
    if (this.dead) return;
    this.dead = true;
    clearTimeout(this.killTimer);
    if (this.busy && this.emit) {
      const emit = this.emit; this.emit = null; this.busy = false;
      emit({ type: "exit", code: code || -1, stderr: [why, this.err.slice(-1500)].filter(Boolean).join("\n") || "엔진이 종료되었습니다." });
    }
    this.log(`claude 상주 프로세스 종료 code=${code}`);
  }

  handle(ev) {
    const emit = this.emit || (() => {});
    if (ev.type === "system" && ev.subtype === "init") {
      if (ev.session_id) this.sessionId = ev.session_id;
      emit({ type: "init", engine: "claude", sessionId: ev.session_id, slashCommands: ev.slash_commands || [] });
    } else if (ev.type === "stream_event") {
      const e = ev.event || {};
      if (e.type === "message_start") this.streamed = false;
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") { this.streamed = true; emit({ type: "text_delta", text: e.delta.text }); }
      if (e.type === "content_block_start" && e.content_block?.type === "text") emit({ type: "text_break" });
    } else if (ev.type === "assistant") {
      for (const b of ev.message?.content || []) {
        if (b.type === "text" && !this.streamed) emit({ type: "text_delta", text: b.text });
        if (b.type === "tool_use" && b.name !== "ToolSearch") emit({ type: "tool_start", id: b.id, name: b.name, ...classify(b.name, b.input), input: brief(b.input, 600) });
      }
    } else if (ev.type === "user") {
      for (const b of ev.message?.content || []) {
        if (b.type === "tool_result") emit({ type: "tool_end", id: b.tool_use_id, ok: !b.is_error, output: brief(toolResultText(b.content), 800) });
      }
    } else if (ev.type === "result") {
      if (ev.session_id) this.sessionId = ev.session_id;
      // total_cost_usd는 프로세스 누적값이라 이번 차례 몫만 뺀다
      const total = ev.total_cost_usd || 0, cost = total - this.costSeen;
      this.costSeen = total;
      this.finishTurn({ type: "done", sessionId: ev.session_id, ok: !ev.is_error, durationMs: ev.duration_ms, costUsd: cost > 0 ? cost : undefined,
        error: ev.is_error ? (this.interrupted ? "중지됨" : ev.errors?.map((e) => (typeof e === "string" ? e : e.message || JSON.stringify(e))).join("\n") || ev.result || ev.subtype) : undefined });
    }
  }
}

// ── Codex ──
export function runCodex({ prompt, ctx, sessionId, cfg, opts = {}, bridgeUrl, emit }) {
  const conf = [
    "-c", `mcp_servers.excel.url="${bridgeUrl}/mcp"`,
    "-c", `mcp_servers.excel.bearer_token_env_var="LOCALXL_TOKEN"`,
    "-c", `mcp_servers.excel.default_tools_approval_mode="approve"`,
  ];
  const args = ["exec", "--json", "--skip-git-repo-check", ...conf, ...(cfg.codexArgs || [])];
  const model = opts.model || cfg.codexModel, effort = opts.effort || cfg.codexEffort;
  if (model) args.push("-m", model);
  if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
  // 프롬프트는 stdin으로 보낸다 ("-"로 시작하는 질문이 옵션으로 읽히지 않게)
  if (sessionId) args.push("resume", sessionId, "-");
  else args.push("-");
  const text = sessionId ? `${contextLine(ctx)}${prompt}` : `${SYSTEM_PROMPT}\n\n${contextLine(ctx)}${prompt}`;

  const child = spawn(cfg.codexBin, args, { cwd: cfg.workdir, env: engineEnv("codex", cfg), detached: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  child.stdin.end(text);
  const t0 = Date.now();
  let thread = sessionId, doneSent = false;
  const done = (ev) => { if (!doneSent) { doneSent = true; emit({ type: "done", sessionId: thread, durationMs: Date.now() - t0, ...ev }); } };
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === "thread.started") { thread = ev.thread_id; emit({ type: "init", engine: "codex", sessionId: thread }); return; }
    if (ev.type === "turn.completed") { done({ ok: true }); return; }
    if (ev.type === "turn.failed" || ev.type === "error") { done({ ok: false, error: ev.error?.message || ev.message }); return; }
    const it = ev.item;
    if (!it) return;
    const started = ev.type === "item.started";
    if (it.type === "agent_message" && !started) { emit({ type: "text_break" }); emit({ type: "text_delta", text: it.text }); }
    else if (it.type === "reasoning" && !started && it.text) emit({ type: "note", text: it.text });
    else if (it.type === "mcp_tool_call") {
      const name = `mcp__${it.server}__${it.tool}`;
      if (started) emit({ type: "tool_start", id: it.id, name, ...classify(name), input: brief(it.arguments, 600) });
      else emit({ type: "tool_end", id: it.id, ok: it.status === "completed", output: brief(it.error?.message || toolResultText(it.result?.content), 800) });
    } else if (it.type === "command_execution") {
      if (started) emit({ type: "tool_start", id: it.id, name: "Bash", kind: "cli", label: String(it.command).slice(0, 80), input: it.command });
      else emit({ type: "tool_end", id: it.id, ok: it.exit_code === 0, output: brief(it.aggregated_output, 800) });
    } else if (it.type === "web_search") {
      if (started) emit({ type: "tool_start", id: it.id, name: "web_search", kind: "web", label: it.query || "웹 검색", input: it.query });
      else emit({ type: "tool_end", id: it.id, ok: true, output: "" });
    } else if (it.type === "file_change" && !started) {
      emit({ type: "tool_start", id: it.id, name: "file_change", kind: "tool", label: "파일 변경", input: brief(it.changes, 600) });
      emit({ type: "tool_end", id: it.id, ok: it.status !== "failed", output: "" });
    }
  });
  return wire(child, emit);
}

// 프로세스 그룹 전체에 SIGTERM, 3초 뒤에도 남아 있으면 SIGKILL
function killTree(child, gone) {
  const sig = (s) => { try { process.kill(-child.pid, s); } catch { try { child.kill(s); } catch {} } };
  sig("SIGTERM");
  setTimeout(() => { if (!gone()) sig("SIGKILL"); }, 3000).unref();
}

// 공통: stderr 수집, 종료 처리, 중지 함수
function wire(child, emit) {
  let err = "";
  let finished = false;
  child.stderr.on("data", (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
  child.on("error", (e) => { if (!finished) { finished = true; emit({ type: "done", ok: false, error: `실행 실패: ${e.message}` }); emit({ type: "exit", code: -1 }); } });
  child.on("close", (code, signal) => {
    if (finished) return;
    finished = true;
    emit({ type: "exit", code, signal, stderr: code ? err.slice(-1500) : undefined });
  });
  return {
    stop() { killTree(child, () => finished); },
  };
}
