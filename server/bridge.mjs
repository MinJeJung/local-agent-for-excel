// LocalXL 브리지: 작업창(WebSocket) ↔ excel MCP(HTTP) ↔ 엔진(claude·codex CLI)
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TOOLS } from "./tools.mjs";
import { ClaudeSession, runCodex, contextLine } from "./engines.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.join(os.homedir(), ".localxl");
fs.mkdirSync(path.join(home, "logs"), { recursive: true });
// LaunchAgent가 표준 출력을 ~/.localxl/logs/bridge.log 에 쌓는다
const log = (...a) => console.log(`${new Date().toLocaleString("sv-SE")} ${a.join(" ")}`);

// ── 설정: ~/.localxl/config.json (없으면 만든다) ──
function which(bin, env = process.env) { try { return execFileSync("/bin/sh", ["-c", 'command -v "$1"', "sh", bin], { encoding: "utf8", env }).trim() || null; } catch { return null; } }
const cfgPath = path.join(home, "config.json");
const saved = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
const cfg = {
  port: 3939,
  token: crypto.randomBytes(24).toString("hex"),
  workdir: os.homedir(),
  claudeBin: which("claude") || "claude",
  codexBin: which("codex") || "codex",
  claudeModel: null,
  claudeEffort: null,
  codexModel: null,
  codexEffort: null,
  claudePermissionMode: null, // null = 사용자 기본 설정 그대로
  codexArgs: [],
  idleMinutes: 30,
  allowApiKey: false, // false = API 키·게이트웨이 변수를 빼고 구독 로그인으로만 실행
  debug: false, // true = /debug/* 검증용 엔드포인트 사용
  ...saved,
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
fs.chmodSync(cfgPath, 0o600); // 토큰이 들어 있으므로 본인만 읽게 한다
const BRIDGE = `http://localhost:${cfg.port}`;

// 엔진은 사용자 로그인 셸과 같은 환경으로 실행한다 (터미널에서 쓰는 claude·codex와 동일하게)
function loginShellEnv() {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    // 셸 시작 파일이 화면에 찍는 글자와 섞이지 않게 표시 문자열 뒤만 읽는다
    const out = execFileSync(shell, ["-ilc", "printf '__LXENV__'; env -0"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    const env = {};
    for (const kv of out.slice(out.lastIndexOf("__LXENV__") + 9).split("\0")) { const i = kv.indexOf("="); if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1); }
    if (env.PATH && env.HOME) return env;
  } catch (e) { log(`로그인 셸 환경을 읽지 못함: ${e.message}`); }
  return { ...process.env };
}
cfg.env = loginShellEnv();
const mcpConfigPath = path.join(home, "mcp-claude.json");
fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { excel: { type: "http", url: `${BRIDGE}/mcp`, headers: { Authorization: `Bearer ${cfg.token}` }, alwaysLoad: true } } }), { mode: 0o600 });
fs.chmodSync(mcpConfigPath, 0o600);
const has = (bin) => !!bin && (path.isAbsolute(bin) ? fs.existsSync(bin) : !!which(bin, cfg.env));
const engines = { claude: has(cfg.claudeBin), codex: has(cfg.codexBin) };

// 슬래시 목록 캐시 (첫 실행 전에도 보이게 사용자 스킬 폴더를 훑는다)
const cachePath = path.join(home, "cache.json");
function scanSkills() {
  const names = new Set();
  for (const dir of [path.join(os.homedir(), ".claude", "skills"), path.join(os.homedir(), ".claude", "commands")]) {
    try { for (const f of fs.readdirSync(dir)) if (!f.startsWith(".")) names.add(f.replace(/\.md$/, "")); } catch {}
  }
  return [...names].sort();
}
let cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
if (!cache.slashCommands?.length) cache.slashCommands = scanSkills();
const saveCache = () => fs.writeFileSync(cachePath, JSON.stringify(cache));

// ── 작업창 연결과 도구 중계 ──
let pane = null;
const pending = new Map();
let seq = 0;
const send = (msg) => { if (pane && pane.readyState === 1) pane.send(JSON.stringify(msg)); };

function relay(name, args, timeoutMs = 60000) {
  if (!pane) return Promise.resolve({ ok: false, error: "작업창이 연결되지 않았습니다. Excel 또는 Google Sheets에서 Local Agent를 여세요." });
  const callId = `t${++seq}`;
  send({ type: "tool_call", callId, name, args });
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(callId); resolve({ ok: false, error: "시간 초과" }); }, timeoutMs);
    pending.set(callId, (msg) => { clearTimeout(timer); resolve(msg); });
  });
}

function buildMcp() {
  const mcp = new McpServer({ name: "excel", version: "0.3.0" });
  for (const t of TOOLS) {
    mcp.tool(t.name, t.description, t.schema, async (args) => {
      const r = await relay(t.name, args);
      const { type, callId, ...rest } = r;
      return { content: [{ type: "text", text: JSON.stringify(rest) }], isError: r.ok === false };
    });
  }
  return mcp;
}

// ── 대화 실행 ──
let gen = 0; // 새 대화를 누를 때마다 올린다. 이전 대화의 늦은 이벤트가 세션 번호를 되살리지 않게 한다
// 대화 번호는 파일에 둔다. 업데이트로 브리지가 다시 떠도 열려 있는 작업창의 대화가 이어진다
const sessions = (cache.sessions ??= { claude: null, codex: null });
function setSession(engine, id) { if (sessions[engine] !== id) { sessions[engine] = id; saveCache(); } }
function resetSessions() { gen++; setSession("claude", null); setSession("codex", null); }
const paneOpts = { claude: {}, codex: {} };
let job = null;
let claude = null; // 미리 띄워 둔 Claude Code 프로세스

function ensureClaude() {
  if (claude && claude.alive && !claude.stale) return claude;
  claude?.kill();
  claude = new ClaudeSession({ cfg, mcpConfigPath, resume: sessions.claude, opts: paneOpts.claude, log });
  log(`claude 상주 프로세스 시작 resume=${sessions.claude || "-"} model=${paneOpts.claude.model || "기본"} effort=${paneOpts.claude.effort || "기본"}`);
  return claude;
}
function restartClaude() {
  if (claude && claude.busy) { claude.stale = true; return; } // 실행 중이면 다음 질문 때 새로 띄운다
  claude?.kill();
  claude = null;
  if (pane && engines.claude) ensureClaude();
}
// 오래 쓰지 않으면 내려서 사용자 MCP 서버들이 계속 떠 있지 않게 한다
setInterval(() => {
  if (claude && claude.alive && !claude.busy && Date.now() - claude.lastUsed > (cfg.idleMinutes || 30) * 60000) { log("claude 상주 프로세스 유휴 종료"); claude.kill(); }
}, 60000).unref();

function startChat({ engine, prompt, ctx }) {
  if (job) return send({ type: "event", ev: { type: "error", text: "이미 실행 중입니다.", busy: true } });
  if (!engines[engine]) return send({ type: "event", ev: { type: "error", text: `${engine} CLI를 찾지 못했습니다. 설치 후 설치 스크립트를 다시 실행하세요.` } });
  const t0 = Date.now(), tools = [], myGen = gen;
  let first = 0;
  const emit = (ev) => {
    if (!first && (ev.type === "text_delta" || ev.type === "tool_start")) first = Date.now() - t0;
    if (ev.type === "tool_start") tools.push(ev.label || ev.name);
    if (ev.type === "init") {
      if (ev.sessionId && myGen === gen) setSession(engine, ev.sessionId);
      if (ev.slashCommands?.length && ev.slashCommands.join() !== (cache.slashCommands || []).join()) {
        cache.slashCommands = ev.slashCommands; saveCache();
      }
    }
    if (ev.type === "done" && ev.sessionId && myGen === gen) setSession(engine, ev.sessionId);
    if (ev.type === "exit") { job = null; log(`차례 종료 ${engine} code=${ev.code} 전체=${((Date.now() - t0) / 1000).toFixed(1)}s 첫반응=${(first / 1000).toFixed(1)}s 도구=${tools.length}${cfg.debug ? `[${tools.join(", ").slice(0, 200)}]` : ""}`);
      if (claude?.stale) restartClaude(); // 실행 중에 설정이 바뀌었으면 이제 새로 띄운다
    }
    send({ type: "event", ev });
  };
  log(`대화 시작 ${engine} resume=${sessions[engine] || "-"}${cfg.debug ? " " + prompt.slice(0, 80).replace(/\n/g, " ") : ""}`); // 요청 내용은 debug일 때만 남긴다
  if (engine === "codex") {
    job = { engine, runner: runCodex({ prompt, ctx, sessionId: sessions.codex, cfg, opts: paneOpts.codex, bridgeUrl: BRIDGE, emit }) };
  } else {
    const s = ensureClaude();
    job = { engine, runner: { stop: () => s.interrupt() } };
    s.send(contextLine(ctx) + prompt, emit);
  }
}

function applySettings(msg) {
  const pick = (o = {}) => ({ model: o.model || undefined, effort: o.effort || undefined });
  const next = { claude: pick(msg.claude), codex: pick(msg.codex) };
  const changed = JSON.stringify(next.claude) !== JSON.stringify(paneOpts.claude);
  Object.assign(paneOpts, next);
  if (changed || !claude || !claude.alive) restartClaude();
}

// ── HTTP ──
// DNS 리바인딩 차단: 다른 도메인 이름으로 들어온 요청은 받지 않는다
const HOSTS = new Set([`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`]);
const app = express();
app.use((req, res, next) => (HOSTS.has(req.headers.host) ? next() : res.status(403).end()));
app.use(express.json({ limit: "50mb" }));
// 토큰은 페이지에 넣지 않는다. 설치 때 매니페스트 주소(?k=)에 넣어 Excel만 알게 한다
app.use("/taskpane", express.static(path.join(root, "taskpane"), { etag: false, maxAge: 0 }));
app.get("/health", (_req, res) => res.json({ ok: true, app: "localxl", pane: !!pane, running: job?.engine || null }));

app.post("/mcp", async (req, res) => {
  if (req.headers.authorization !== `Bearer ${cfg.token}`) return res.status(401).json({ error: "unauthorized" });
  try {
    const mcp = buildMcp();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    log(`MCP 요청 오류: ${e.message}`);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});
app.get("/mcp", (_req, res) => res.status(405).end());
app.delete("/mcp", (_req, res) => res.status(405).end());

// 개발·검증용 (설정 debug: true 일 때만): 작업창에 도구를 직접 보내거나 대화를 시작한다
if (cfg.debug) {
  app.post("/debug/tool", async (req, res) => {
    if (req.headers.authorization !== `Bearer ${cfg.token}`) return res.status(401).end();
    res.json(await relay(req.body.name, req.body.args));
  });
  app.post("/debug/reload", (req, res) => {
    if (req.headers.authorization !== `Bearer ${cfg.token}`) return res.status(401).end();
    send({ type: req.query.undo ? "undo" : "reload" });
    res.json({ ok: !!pane });
  });
  app.post("/debug/settings", (req, res) => {
    if (req.headers.authorization !== `Bearer ${cfg.token}`) return res.status(401).end();
    applySettings(req.body);
    res.json({ ok: true, paneOpts });
  });
  app.post("/debug/stop", (req, res) => {
    if (req.headers.authorization !== `Bearer ${cfg.token}`) return res.status(401).end();
    job?.runner.stop();
    res.json({ ok: !!job });
  });
  app.post("/debug/chat", (req, res) => {
    if (req.headers.authorization !== `Bearer ${cfg.token}`) return res.status(401).end();
    if (!pane) return res.status(409).json({ error: "작업창 없음" });
    send({ type: "remote_prompt", engine: req.body.engine || "claude", prompt: req.body.prompt });
    res.json({ ok: true });
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (sock, req) => {
  const q = new URL(req.url, "http://x").searchParams;
  if (!HOSTS.has(req.headers.host) || q.get("token") !== cfg.token) return sock.close(4001, "unauthorized");
  // 다른 통합 문서의 작업이 도는 중이면 그 작업창을 그대로 둔다
  const busyElsewhere = job && pane && pane !== sock && pane.readyState === 1;
  if (!busyElsewhere) pane = sock;
  // 작업창을 새로 열면 빈 화면이므로 새 대화로 시작한다. 연결만 다시 된 경우(브리지 재시작)는 대화를 잇는다
  if (q.get("fresh") && !job) { resetSessions(); restartClaude(); }
  log(`작업창 연결됨${q.get("fresh") ? " (새 대화)" : ""}`);
  send({ type: "hello", slashCommands: cache.slashCommands || [], running: job?.engine || null, engines,
    billing: cfg.allowApiKey ? "api" : "subscription" });
  sock.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === "tool_result" && pending.has(msg.callId)) { pending.get(msg.callId)(msg); pending.delete(msg.callId); }
    else if (msg.type === "chat") {
      // 통합 문서가 여러 개면 요청한 작업창에 도구를 보낸다. 다른 작업창의 작업이 도는 중이면 받지 않는다
      if (job && pane !== sock) sock.send(JSON.stringify({ type: "event", ev: { type: "error", text: "다른 문서의 작업이 실행 중입니다." } }));
      else { pane = sock; startChat(msg); }
    }
    else if (job && pane !== sock) return; // 다른 통합 문서의 작업은 그 작업창만 멈추거나 바꾼다
    else if (msg.type === "stop") { job?.runner.stop(); log("중지 요청"); }
    else if (msg.type === "new_session") { job?.runner.stop(); resetSessions(); log("새 대화"); restartClaude(); }
    else if (msg.type === "settings") applySettings(msg);
  });
  sock.on("close", () => {
    if (pane !== sock) return;
    pane = [...wss.clients].find((c) => c !== sock && c.readyState === 1) || null; // 다른 통합 문서의 작업창이 있으면 그쪽으로
    log("작업창 연결 끊김");
    // 기다리던 도구 호출은 바로 실패로 돌려준다 (60초 시간 초과까지 기다리지 않게)
    for (const [id, done] of pending) { pending.delete(id); done({ ok: false, error: "Excel 작업창 연결이 끊겼습니다." }); }
  });
});

// 브리지가 내려갈 때 엔진 프로세스도 함께 끝낸다 (엔진은 별도 프로세스 그룹이라 저절로 끝나지 않는다)
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => {
  log(`브리지 종료 (${sig})`);
  claude?.kill();
  if (job?.engine === "codex") job.runner.stop();
  process.exit(0);
});

wss.on("error", () => {}); // ws가 서버 오류를 다시 던지므로 아래 server 처리기에서만 다룬다
server.on("error", (e) => {
  log(e.code === "EADDRINUSE" ? `포트 ${cfg.port}을 다른 프로그램이 쓰고 있습니다. ~/.localxl/config.json의 port를 바꾸고 설치를 다시 실행하세요.` : `브리지 시작 실패: ${e.message}`);
  process.exit(1);
});
server.listen(cfg.port, "127.0.0.1", () => log(`LocalXL 브리지 시작 ${BRIDGE} (claude=${cfg.claudeBin}, codex=${cfg.codexBin})`));
