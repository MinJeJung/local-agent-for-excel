// 작업창 채팅 UI: 브리지와 WebSocket으로 연결하고, 대화만 보여 준다 (도구 실행은 진행 문구 한 줄로만).
/* global Office, Excel, LXTools */
(function () {
  const $ = (id) => document.getElementById(id);
  const logEl = $("log"), input = $("input"), sendBtn = $("send"), slashEl = $("slash");
  const DOING = { excel: "Excel 작업 중", web: "웹에서 찾는 중", mcp: "도구 사용 중", skill: "스킬 사용 중", cli: "명령 실행 중", agent: "에이전트 작업 중" };
  const ICON_SEND = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg>';
  const ICON_STOP = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor"/></svg>';
  const emptyTpl = $("empty").cloneNode(true);
  let ws = null, running = false, slashCommands = [], aiEl = null, lastAi = null, slashSel = 0, billing = "subscription";

  // 엔진·모델·강도 선택. 엔진별로 따로 기억하고, 바뀌면 브리지에 알려 Claude 프로세스를 새 설정으로 미리 띄운다.
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const opts = { claude: JSON.parse(store.get("lx.opts.claude", "{}")), codex: JSON.parse(store.get("lx.opts.codex", "{}")) };
  function showOpts() {
    const eng = $("engine").value;
    $("model").style.display = eng === "claude" ? "" : "none"; // Codex 모델은 내 config.toml 설정을 따른다
    $("model").value = opts[eng].model || "";
    $("effort").value = opts[eng].effort || "";
  }
  function pushSettings() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "settings", claude: opts.claude, codex: opts.codex })); }
  $("engine").value = store.get("lx.engine", "claude");
  showOpts();
  $("engine").onchange = () => { store.set("lx.engine", $("engine").value); showOpts(); };
  for (const id of ["model", "effort"]) $(id).onchange = () => {
    const eng = $("engine").value;
    opts[eng][id] = $(id).value || undefined;
    store.set(`lx.opts.${eng}`, JSON.stringify(opts[eng]));
    pushSettings();
  };

  // ── 메시지 ──
  const statusEl = document.createElement("div");
  statusEl.className = "status";
  statusEl.innerHTML = '<span class="spark">✻</span><span class="st-text"></span>';
  function setStatus(text) { statusEl.lastChild.textContent = text; logEl.appendChild(statusEl); scrollDown(); }
  const scrollDown = () => { logEl.scrollTop = logEl.scrollHeight; };
  function add(cls, text) {
    $("empty")?.remove();
    const el = document.createElement("div");
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    logEl.insertBefore(el, statusEl.isConnected ? statusEl : null); // 진행 문구는 항상 맨 아래
    scrollDown();
    return el;
  }
  // 간단한 마크다운: 코드 블록, 제목, 목록, **굵게**, `코드`
  function renderAi(el) {
    const esc = el.dataset.raw.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    el.innerHTML = esc.split("```").map((part, i) => i % 2 ? `<pre>${part.replace(/^[\w-]*\n/, "")}</pre>` : part
      .replace(/^#{1,6} (.+)$/gm, "<b>$1</b>")
      .replace(/^(\s*)[-*] /gm, "$1• ")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")).join("");
  }

  function updateSend() { sendBtn.disabled = !running && !input.value.trim(); }
  function setRunning(on) {
    running = on;
    sendBtn.innerHTML = on ? ICON_STOP : ICON_SEND;
    sendBtn.title = on ? "중지" : "보내기 (Enter)";
    sendBtn.setAttribute("aria-label", on ? "중지" : "보내기");
    sendBtn.classList.toggle("stop", on);
    $("newChat").disabled = on;
    $("engine").disabled = on; $("model").disabled = on; $("effort").disabled = on;
    $("undo").disabled = on || !LXTools.canUndo();
    if (on && !statusEl.isConnected) setStatus("생각하는 중");
    updateSend();
  }

  function onEvent(ev) {
    switch (ev.type) {
      case "init":
        if (ev.slashCommands?.length) slashCommands = ev.slashCommands;
        break;
      case "text_break":
        aiEl = null;
        break;
      case "text_delta":
        statusEl.remove();
        if (!aiEl) { aiEl = lastAi = add("msg-ai"); aiEl.dataset.raw = ""; }
        aiEl.dataset.raw += ev.text;
        renderAi(aiEl);
        scrollDown();
        break;
      case "tool_start":
        aiEl = null;
        setStatus(DOING[ev.kind] || "작업 중");
        break;
      case "done": {
        // 걸린 시간과 사용량은 답변에 마우스를 올리면 보인다
        const parts = [];
        if (ev.durationMs) parts.push(`${(ev.durationMs / 1000).toFixed(1)}초`);
        if (ev.costUsd) parts.push(billing === "api" ? `API 사용 $${ev.costUsd.toFixed(3)}` : `구독 사용 (API 환산 $${ev.costUsd.toFixed(3)})`);
        if (lastAi) lastAi.title = parts.join(" · ");
        if (!ev.ok && ev.error) ev.error === "중지됨" ? add("note", "중지했습니다.") : add("err", ev.error);
        break;
      }
      case "exit":
        if (ev.code && ev.stderr) add("err", `엔진 종료(코드 ${ev.code})\n${ev.stderr}`);
        finishTurn();
        break;
      case "error":
        add("err", ev.text);
        if (!ev.busy) finishTurn(); // 실행 중인 다른 작업 때문이면 그 작업이 끝날 때 정리된다
        break;
    }
  }

  function finishTurn() {
    LXTools.endTurn();
    aiEl = lastAi = null;
    statusEl.remove();
    setRunning(false);
  }

  async function sendPrompt(text, engineOverride) {
    text = text.trim();
    if (!text || running || !ws || ws.readyState !== 1) return;
    if (engineOverride) $("engine").value = engineOverride;
    add("msg-user", text);
    input.value = ""; autosize(); hideSlash();
    setRunning(true); // Excel 상황을 읽는 동안 Enter가 한 번 더 눌려도 두 번 보내지 않게 먼저 막는다
    LXTools.beginTurn(text.slice(0, 40));
    let ctx = null;
    try { ctx = await LXTools.readContext({ withSelection: !$("selChip").hidden }); } catch (e) {}
    ws.send(JSON.stringify({ type: "chat", engine: $("engine").value, prompt: text, ctx }));
  }

  // ── 입력창 ──
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(160, input.scrollHeight) + "px"; }
  function slashMatches() {
    const m = input.value.match(/^\/(\S*)$/);
    if (!m) return null;
    const q = m[1].toLowerCase();
    return slashCommands.filter((c) => c.toLowerCase().includes(q)).slice(0, 50);
  }
  function hideSlash() { slashEl.style.display = "none"; }
  function showSlash() {
    const list = slashMatches();
    if (!list || !list.length) return hideSlash();
    slashSel = Math.min(slashSel, list.length - 1);
    slashEl.innerHTML = "";
    list.forEach((c, i) => {
      const d = document.createElement("div");
      d.textContent = "/" + c;
      if (i === slashSel) d.className = "sel";
      d.onmousedown = (e) => { e.preventDefault(); pickSlash(c); };
      slashEl.appendChild(d);
    });
    slashEl.style.display = "block";
    slashEl.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }
  function pickSlash(c) { input.value = "/" + c + " "; hideSlash(); input.focus(); autosize(); updateSend(); }

  input.addEventListener("input", () => { autosize(); updateSend(); slashSel = 0; showSlash(); });
  input.addEventListener("keydown", (e) => {
    const list = slashEl.style.display === "block" ? slashMatches() : null;
    if (list && list.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); slashSel = (slashSel + 1) % list.length; return showSlash(); }
      if (e.key === "ArrowUp") { e.preventDefault(); slashSel = (slashSel - 1 + list.length) % list.length; return showSlash(); }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); return pickSlash(list[slashSel]); }
      if (e.key === "Escape") return hideSlash();
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendPrompt(input.value); }
  });
  sendBtn.onclick = () => { if (running) ws?.send(JSON.stringify({ type: "stop" })); else sendPrompt(input.value); };
  logEl.addEventListener("click", (e) => {
    const b = e.target.closest(".ex");
    if (b) { input.value = b.textContent; autosize(); updateSend(); input.focus(); }
  });
  $("newChat").onclick = () => {
    ws?.send(JSON.stringify({ type: "new_session" }));
    logEl.replaceChildren(emptyTpl.cloneNode(true));
  };
  $("undo").onclick = async () => {
    try {
      const r = await LXTools.undo();
      if (r.ok) add("note", `되돌렸습니다. 범위 ${r.ranges}개의 값·수식을 복구했습니다.${r.skipped ? ` 없어진 시트의 범위 ${r.skipped}개는 건너뛰었습니다.` : ""}${r.partial ? " 큰 범위는 복구하지 못했습니다." : ""} 서식·표·차트는 그대로입니다.`);
    } catch (e) { add("err", "되돌리기 실패: " + e.message); }
    $("undo").disabled = !LXTools.canUndo();
  };

  // ── 선택 범위 ──
  // 사용자가 직접 고른 범위만 칩으로 보여 주고 요청에 함께 보낸다.
  // 에이전트가 쓴 범위를 선택해 보여 줄 때(실행 중이거나 도구 실행 직후)는 칩을 내린다.
  let agentSelUntil = 0;
  function showSel(addr) { $("selText").textContent = addr || ""; $("selChip").hidden = !addr; }
  async function onSelChanged() {
    if (running || Date.now() < agentSelUntil) return showSel(null);
    const sel = await LXTools.selection();
    showSel(sel && sel.includes(":") ? sel : null);
  }
  $("selClose").onclick = () => { showSel(null); input.focus(); };

  // 점검용: 작업창 요소 크기와 화면 안 여부 (브리지 /debug/tool 의 __inspect)
  function inspect() {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), shown: r.width > 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }; };
    const out = { ok: true, viewport: [innerWidth, innerHeight], scrollX: document.documentElement.scrollWidth > innerWidth, messages: [...logEl.children].map((el) => `${el.className}: ${el.textContent.slice(0, 80)}`) };
    for (const id of ["engine", "model", "effort", "undo", "newChat", "input", "send", "selChip"]) out[id] = { ...box($(id)), value: $(id).value, text: $(id).tagName === "SELECT" ? $(id).selectedOptions[0]?.textContent : $(id).textContent.trim() || undefined, disabled: $(id).disabled };
    return out;
  }

  // ── 브리지 연결 ──
  // 연결 키는 설치 때 매니페스트 주소(?k=)에 들어간다. 페이지 자체에는 키가 없다
  const TOKEN = new URLSearchParams(location.search).get("k");
  let fresh = true; // 처음 연결할 때만 새 대화. 다시 연결될 때는 대화를 잇는다
  function connect() {
    if (!TOKEN) { $("conn").textContent = "연결 안 됨"; return add("err", "연결 키가 없습니다. 설치 스크립트를 다시 실행한 뒤 Excel을 Cmd+Q로 완전히 종료하고 다시 여세요."); }
    ws = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(TOKEN)}${fresh ? "&fresh=1" : ""}`);
    fresh = false;
    ws.onopen = () => { $("conn").classList.add("on"); pushSettings(); };
    ws.onclose = () => {
      $("conn").classList.remove("on");
      if (running) { add("err", "브리지 연결이 끊겼습니다."); finishTurn(); }
      setTimeout(connect, 2000);
    };
    ws.onmessage = async (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "hello") {
        if (msg.slashCommands?.length) slashCommands = msg.slashCommands;
        const opt = (v) => $("engine").querySelector(`option[value=${v}]`);
        if (msg.engines) {
          for (const k of ["claude", "codex"]) { const o = opt(k); o.dataset.name ??= o.textContent; o.disabled = !msg.engines[k]; o.textContent = o.dataset.name + (msg.engines[k] ? "" : " (설치 안 됨)"); }
          // 고른 엔진이 없으면 설치된 엔진으로 바꾼다 (Codex만 쓰는 사용자)
          const other = ["claude", "codex"].find((k) => msg.engines[k]);
          if (!msg.engines[$("engine").value] && other) { $("engine").value = other; store.set("lx.engine", other); showOpts(); }
        }
        if (msg.billing) billing = msg.billing;
        if (msg.running && !running) setRunning(true); // 작업창을 다시 열었을 때 실행 중인 작업을 멈출 수 있게
      } else if (msg.type === "event") onEvent(msg.ev);
      else if (msg.type === "reload") location.reload();
      else if (msg.type === "undo") $("undo").click();
      else if (msg.type === "remote_prompt") sendPrompt(msg.prompt, msg.engine);
      else if (msg.type === "tool_call") {
        agentSelUntil = Date.now() + 1500;
        const res = msg.name === "__inspect" ? inspect() : await LXTools.run(msg.name, msg.args);
        agentSelUntil = Date.now() + 1500;
        ws.send(JSON.stringify({ type: "tool_result", callId: msg.callId, ...res }));
      }
    };
  }

  Office.onReady(async () => {
    setRunning(false);
    connect();
    // 작업창을 열 때 이미 여러 셀을 골라 두었으면 칩으로 보여 준다 (기본 A1 한 칸은 보이지 않는다)
    const sel = await LXTools.selection();
    if (sel && sel.includes(":")) showSel(sel);
    try { Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelChanged); } catch (e) {}
    input.focus();
  });
})();
