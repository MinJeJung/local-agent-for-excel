// Excel 도구 실행부 (Office.js). 브리지가 보낸 tool_call을 여기서 처리한다.
/* global Excel, Office */
(function () {
  const MAX_UNDO_CELLS = 50000;
  const undoStack = []; // { label, items: [{ sheet, address, formulas }] }
  let turnUndo = null;

  function split(addr) {
    const i = addr.lastIndexOf("!");
    if (i < 0) return { sheet: null, ref: addr };
    return { sheet: addr.slice(0, i).replace(/^'|'$/g, "").replace(/''/g, "'"), ref: addr.slice(i + 1) };
  }
  function sheetOf(ctx, name) {
    return name ? ctx.workbook.worksheets.getItem(name) : ctx.workbook.worksheets.getActiveWorksheet();
  }
  function getRange(ctx, addr) {
    const { sheet, ref } = split(addr);
    return sheetOf(ctx, sheet).getRange(ref);
  }
  function dims(grid) {
    return { rows: grid.length, cols: Math.max(0, ...grid.map((r) => r.length)) };
  }
  function pad(grid, cols) {
    return grid.map((r) => (r.length < cols ? r.concat(Array(cols - r.length).fill("")) : r)).map((r) => r.map((v) => (v === null ? "" : v)));
  }
  // 시작 셀만 주거나 크기가 다르면 배열 크기에 맞춘다
  function fit(range, grid) {
    const { rows, cols } = dims(grid);
    return range.getCell(0, 0).getResizedRange(rows - 1, cols - 1);
  }

  // cells를 모르면 크기를 먼저 본다. 큰 범위의 수식을 통째로 읽으면 Excel 전송 한도를 넘는다
  async function snapshot(ctx, range, cells) {
    if (!turnUndo) return;
    if (cells === undefined) { range.load("cellCount"); await ctx.sync(); cells = range.cellCount; }
    if (cells > MAX_UNDO_CELLS) { turnUndo.partial = true; return; }
    range.load("address,formulas");
    await ctx.sync();
    const { sheet, ref } = split(range.address);
    turnUndo.items.push({ sheet, address: ref, formulas: range.formulas });
  }

  // 쓴 범위를 선택해 보여 준다. 숨긴 시트처럼 선택할 수 없으면 무시한다 (쓰기는 이미 끝났다)
  async function flash(ctx, range) {
    try { range.select(); await ctx.sync(); } catch (e) {}
  }

  // 차트·도형이 선택돼 있으면 범위 선택이 없으므로 null을 돌려준다
  async function readSelection() {
    try {
      return await Excel.run(async (ctx) => { const sel = ctx.workbook.getSelectedRange(); sel.load("address"); await ctx.sync(); return sel.address; });
    } catch (e) { return null; }
  }

  // 시트 목록과 시트별 사용 범위·표·차트 (동기화 두 번)
  async function listSheets(ctx) {
    const sheets = ctx.workbook.worksheets;
    sheets.load("items/name,items/visibility");
    const active = sheets.getActiveWorksheet(); active.load("name");
    await ctx.sync();
    const info = sheets.items.map((s) => {
      const u = s.getUsedRangeOrNullObject(true); u.load("address,rowCount,columnCount");
      s.tables.load("items/name"); s.charts.load("items/name");
      return { s, u };
    });
    await ctx.sync();
    return {
      activeSheet: active.name,
      sheets: info.map(({ s, u }) => ({
        name: s.name, hidden: s.visibility !== "Visible",
        usedRange: u.isNullObject ? null : u.address, rows: u.isNullObject ? 0 : u.rowCount, cols: u.isNullObject ? 0 : u.columnCount,
        tables: s.tables.items.map((t) => t.name), charts: s.charts.items.map((c) => c.name),
      })),
    };
  }

  const tools = {
    async get_workbook_info() {
      const info = await Excel.run(listSheets);
      return { ok: true, ...info, selection: await readSelection() };
    },

    async read_range({ range, maxCells = 2000 }) {
      return Excel.run(async (ctx) => {
        const r = getRange(ctx, range);
        r.load("address,rowCount,columnCount");
        await ctx.sync();
        let target = r, truncated = false;
        if (r.rowCount * r.columnCount > maxCells) {
          const rows = Math.max(1, Math.floor(maxCells / r.columnCount));
          target = r.getCell(0, 0).getResizedRange(rows - 1, Math.min(r.columnCount, maxCells) - 1);
          truncated = true;
        }
        target.load("address,values,formulas,numberFormat");
        await ctx.sync();
        const hasFormula = target.formulas.some((row) => row.some((f) => typeof f === "string" && f.startsWith("=")));
        return { ok: true, address: target.address, fullAddress: r.address, rows: r.rowCount, cols: r.columnCount, truncated,
          values: target.values, formulas: hasFormula ? target.formulas : undefined };
      });
    },

    async write_range({ range, values, formulas, numberFormat }) {
      const grid = formulas || values;
      if (!grid || !grid.length) return { ok: false, error: "values 또는 formulas가 필요합니다" };
      return Excel.run(async (ctx) => {
        const { cols } = dims(grid);
        if (!cols) return { ok: false, error: "빈 배열입니다" };
        const data = pad(grid, cols);
        const r = fit(getRange(ctx, range), data);
        await snapshot(ctx, r, data.length * cols);
        if (numberFormat) r.numberFormat = data.map((row) => row.map(() => numberFormat));
        if (formulas) r.formulas = data; else r.values = data;
        r.load("address");
        await ctx.sync();
        await flash(ctx, r);
        return { ok: true, changedRange: r.address, cells: data.length * cols };
      });
    },

    async format_range(a) {
      return Excel.run(async (ctx) => {
        const r = getRange(ctx, a.range);
        const f = r.format;
        if (a.bold !== undefined) f.font.bold = a.bold;
        if (a.italic !== undefined) f.font.italic = a.italic;
        if (a.fontColor) f.font.color = a.fontColor;
        if (a.fontSize) f.font.size = a.fontSize;
        if (a.fillColor) { if (a.fillColor === "none") f.fill.clear(); else f.fill.color = a.fillColor; }
        if (a.horizontalAlignment) f.horizontalAlignment = a.horizontalAlignment;
        if (a.wrapText !== undefined) f.wrapText = a.wrapText;
        if (a.numberFormat) {
          r.load("rowCount,columnCount"); await ctx.sync();
          if (r.rowCount * r.columnCount > 200000) return { ok: false, error: "표시 형식 범위가 너무 큽니다. 데이터가 있는 범위로 좁혀 다시 호출하세요." };
          r.numberFormat = Array.from({ length: r.rowCount }, () => Array(r.columnCount).fill(a.numberFormat));
        }
        if (a.borders) {
          ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight", "InsideHorizontal", "InsideVertical"].forEach((e) => {
            const b = f.borders.getItem(e); b.style = "Continuous"; b.weight = "Thin"; b.color = "#BFBFBF";
          });
        }
        if (a.columnWidth) f.columnWidth = a.columnWidth;
        if (a.autofitColumns) f.autofitColumns();
        r.load("address");
        await ctx.sync();
        return { ok: true, formattedRange: r.address };
      });
    },

    async manage_sheet({ action, name, names, newName }) {
      return Excel.run(async (ctx) => {
        const ws = ctx.workbook.worksheets;
        const targets = names?.length ? names : name ? [name] : [];
        if (!targets.length) return { ok: false, error: "name 또는 names가 필요합니다" };
        let existed;
        if (action === "add") {
          const ex = ws.getItemOrNullObject(targets[0]); await ctx.sync();
          existed = !ex.isNullObject;
          (existed ? ex : ws.add(targets[0])).activate();
        } else if (action === "rename") {
          const s = ws.getItem(targets[0]); s.name = newName; s.activate();
        } else if (action === "activate") {
          ws.getItem(targets[0]).activate();
        } else if (action === "delete") {
          for (const n of targets) ws.getItem(n).delete();
        } else if (action === "hide" || action === "unhide") {
          for (const n of targets) ws.getItem(n).visibility = action === "hide" ? "Hidden" : "Visible";
        }
        await ctx.sync();
        const after = await listSheets(ctx);
        return { ok: true, action, targets, existed, activeSheet: after.activeSheet, sheets: after.sheets.map((s) => s.name + (s.hidden ? " (숨김)" : "")) };
      });
    },

    async create_table({ range, hasHeaders = true, name, style }) {
      return Excel.run(async (ctx) => {
        const r = getRange(ctx, range);
        r.load("address"); await ctx.sync();
        const { sheet } = split(r.address);
        const t = sheetOf(ctx, sheet).tables.add(r.address, hasHeaders);
        if (name) t.name = name;
        if (style) t.style = style;
        t.load("name"); await ctx.sync();
        return { ok: true, table: t.name, range: r.address };
      });
    },

    async create_chart({ sourceRange, type = "ColumnClustered", title, anchorCell, seriesBy = "Auto" }) {
      return Excel.run(async (ctx) => {
        const r = getRange(ctx, sourceRange);
        r.load("address,columnIndex,columnCount,rowIndex"); await ctx.sync();
        const { sheet } = split(r.address);
        const ws = sheetOf(ctx, sheet);
        const chart = ws.charts.add(type, r, seriesBy);
        if (title) { chart.title.text = title; chart.title.visible = true; }
        const anchor = anchorCell ? ws.getRange(anchorCell) : ws.getCell(r.rowIndex, r.columnIndex + r.columnCount + 1);
        chart.setPosition(anchor);
        chart.width = 480; chart.height = 288;
        chart.load("name"); ws.load("name"); await ctx.sync();
        return { ok: true, chart: chart.name, sheet: ws.name };
      });
    },

    async run_script({ code }) {
      const fn = new Function("context", "Excel", `"use strict"; return (async () => {\n${code}\n})();`);
      return Excel.run(async (ctx) => {
        const result = await fn(ctx, Excel);
        await ctx.sync();
        return { ok: true, result: result === undefined ? null : result };
      });
    },

    async batch({ ops }) {
      const results = [];
      for (const [i, op] of ops.entries()) {
        const r = await run(op.tool, op.args);
        results.push({ tool: op.tool, ...r });
        if (r.ok === false) return { ok: false, error: `${i + 1}번째 작업(${op.tool}) 실패: ${r.error}`, done: i, results };
      }
      return { ok: true, done: ops.length, results };
    },

    async clear_range({ range, what = "contents" }) {
      return Excel.run(async (ctx) => {
        const r = getRange(ctx, range);
        await snapshot(ctx, r);
        r.clear({ contents: "Contents", formats: "Formats", all: "All" }[what]);
        r.load("address"); await ctx.sync();
        return { ok: true, clearedRange: r.address };
      });
    },
  };

  // 요청과 함께 보내는 상황: 시트 구조는 항상, 선택 범위 값은 선택 전달을 켰을 때만 (최대 PREVIEW_CELLS 셀)
  const PREVIEW_CELLS = 300;
  async function readContext({ withSelection = true } = {}) {
    const info = await Excel.run(listSheets);
    const ctxInfo = { activeSheet: info.activeSheet, sheets: info.sheets };
    if (!withSelection) return ctxInfo;
    ctxInfo.selection = await readSelection();
    if (ctxInfo.selection) {
      try {
        await Excel.run(async (ctx) => {
          const sel = ctx.workbook.getSelectedRange(); sel.load("rowCount,columnCount"); await ctx.sync();
          if (sel.rowCount * sel.columnCount <= 1) return;
          const cols = Math.min(sel.columnCount, 30), rows = Math.max(1, Math.min(sel.rowCount, Math.floor(PREVIEW_CELLS / cols)));
          const part = sel.getCell(0, 0).getResizedRange(rows - 1, cols - 1); part.load("values"); await ctx.sync();
          ctxInfo.preview = part.values;
          ctxInfo.previewTruncated = rows < sel.rowCount || cols < sel.columnCount;
        });
      } catch (e) { /* 미리보기 실패는 무시 */ }
    }
    return ctxInfo;
  }

  async function run(name, args) {
    if (!tools[name]) return { ok: false, error: `알 수 없는 도구: ${name}` };
    try { return await tools[name](args || {}); } catch (e) { return { ok: false, error: e.message || String(e), code: e.code }; }
  }

  // 작업창 화면(app.js)이 쓰는 호스트 정보. 연결 키는 설치 때 매니페스트 주소(?k=)에 들어간다. 페이지 자체에는 키가 없다
  window.LXHost = {
    name: "excel",
    label: "Excel",
    ready: (cb) => Office.onReady(cb),
    connection: async () => ({ url: `ws://${location.host}/ws`, token: new URLSearchParams(location.search).get("k") }),
    noKeyMessage: "연결 키가 없습니다. 설치 스크립트를 다시 실행한 뒤 Excel을 Cmd+Q로 완전히 종료하고 다시 여세요.",
    watchSelection(cb) { try { Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => cb()); } catch (e) {} },
  };

  window.LXTools = {
    run,
    readContext,
    selection: readSelection,
    beginTurn(label) { turnUndo = { label, items: [] }; },
    endTurn() {
      if (turnUndo && turnUndo.items.length) undoStack.push(turnUndo);
      if (undoStack.length > 30) undoStack.shift(); // 오래된 기록은 버린다 (메모리)
      turnUndo = null;
    },
    canUndo: () => undoStack.length > 0,
    async undo() {
      const t = undoStack.pop();
      if (!t) return { ok: false };
      // 같은 차례에 이름을 바꾸거나 지운 시트는 건너뛴다 (하나 때문에 전체가 실패하지 않게)
      let skipped = 0;
      await Excel.run(async (ctx) => {
        const sheets = t.items.map((it) => ctx.workbook.worksheets.getItemOrNullObject(it.sheet));
        await ctx.sync();
        for (let i = t.items.length - 1; i >= 0; i--) {
          if (sheets[i].isNullObject) skipped++;
          else sheets[i].getRange(t.items[i].address).formulas = t.items[i].formulas;
        }
        await ctx.sync();
      });
      return { ok: true, label: t.label, ranges: t.items.length - skipped, skipped, partial: !!t.partial };
    },
  };
})();
