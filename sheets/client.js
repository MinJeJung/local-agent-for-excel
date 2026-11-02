// Google Sheets 사이드바용 도구 실행부와 호스트 어댑터. 도구는 Apps Script(Code.js)가 실행한다.
/* global google */
(function () {
  const gs = (fn, ...args) => new Promise((resolve, reject) =>
    google.script.run.withSuccessHandler(resolve).withFailureHandler((e) => reject(e instanceof Error ? e : new Error(String(e))))[fn](...args));
  const undoStack = [];
  let turnUndo = null;

  async function run(name, args) {
    try {
      const res = await gs("runTool", name, args || {});
      if (res && res._undo) {
        if (turnUndo) { turnUndo.items.push(...res._undo.items); turnUndo.partial ||= res._undo.partial; }
        delete res._undo;
      }
      return res;
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  }

  window.LXTools = {
    run,
    readContext: ({ withSelection = true } = {}) => gs("readContext", withSelection),
    selection: () => gs("selection").catch(() => null),
    beginTurn(label) { turnUndo = { label, items: [] }; },
    endTurn() {
      if (turnUndo && turnUndo.items.length) undoStack.push(turnUndo);
      if (undoStack.length > 30) undoStack.shift();
      turnUndo = null;
    },
    canUndo: () => undoStack.length > 0,
    async undo() {
      const t = undoStack.pop();
      if (!t) return { ok: false };
      const r = await gs("restore", t.items);
      return { ok: true, label: t.label, ranges: r.ranges, skipped: r.skipped, partial: !!t.partial };
    },
  };

  // 연결 키가 없으면 입력 칸을 보여 주고, 저장한 뒤 연결한다
  function askKey() {
    return new Promise((resolve) => {
      const empty = document.getElementById("empty");
      if (empty) empty.hidden = true;
      const box = document.createElement("div");
      box.className = "keybox";
      // Apps Script 화면 변환이 스크립트 안의 태그 문자열을 잘못 읽어 DOM으로 만든다
      const el = (tag, props) => Object.assign(document.createElement(tag), props);
      const help = el("p", { textContent: "Mac 터미널에서 아래 명령을 실행하면 키가 클립보드에 복사됩니다. 여기에 붙여 넣으세요. 이 시트에서 한 번만 입력합니다." });
      box.append(el("b", { textContent: "연결 키를 입력하세요" }), help, el("code", { textContent: "zsh ~/.localxl/app/scripts/sheets-attach.sh <이 시트 주소>" }),
        el("input", { id: "keyIn", type: "password", placeholder: "연결 키", autocomplete: "off" }), el("button", { id: "keySave", textContent: "저장" }));
      document.getElementById("log").appendChild(box);
      const save = async () => {
        const v = document.getElementById("keyIn").value.trim();
        if (!v) return;
        // 기본 포트가 아니면 키 앞에 "포트:"가 붙어 있다
        const m = /^(\d+):(.+)$/.exec(v);
        const c = await gs("saveConnection", m ? m[2] : v, m ? Number(m[1]) : 3939);
        box.remove();
        if (empty) empty.hidden = false;
        resolve(c);
      };
      document.getElementById("keySave").onclick = save;
      document.getElementById("keyIn").onkeydown = (e) => { if (e.key === "Enter") save(); };
      document.getElementById("keyIn").focus();
    });
  }

  window.LXHost = {
    name: "sheets",
    label: "시트",
    ready: (cb) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", cb) : cb()),
    async connection() {
      let c = await gs("getConnection");
      if (!c.token) c = await askKey();
      // Apps Script는 줄의 // 뒤를 주석으로 지운다. 문자열 안에서도 그래서 \/로 나눠 쓴다
      return { url: `ws:\/\/localhost:${c.port}/ws`, token: c.token };
    },
    noKeyMessage: "연결 키가 없습니다. 메뉴 Local Agent > 연결 키 다시 입력을 누르세요.",
    // 사이드바에는 선택 변경 이벤트가 없어 2초마다 확인한다
    watchSelection(cb) {
      let last = null;
      setInterval(async () => {
        if (document.hidden) return;
        const sel = await window.LXTools.selection();
        if (sel !== last) { last = sel; cb(sel); }
      }, 2000);
    },
  };
})();
