/**
 * Local Agent for Sheets: 사이드바가 브리지와 대화하고, 시트 도구는 여기(SpreadsheetApp)서 실행한다.
 * @OnlyCurrentDoc
 */
const MAX_UNDO_CELLS = 20000;

// 시트에 붙인 스크립트와 Marketplace 부가기능 모두 확장 프로그램 메뉴 아래에 둔다.
// 부가기능은 권한 승인 전(AuthMode.NONE)에도 onOpen이 불리므로 메뉴만 만든다.
function onOpen() {
  SpreadsheetApp.getUi().createAddonMenu().addItem("열기", "showSidebar").addItem("연결 키 다시 입력", "resetKey").addToUi();
}
function onInstall() { onOpen(); }
function showSidebar() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("Sidebar").setTitle("Local Agent"));
}

// 연결 키는 이 스크립트의 내 사용자 속성에만 둔다 (공동 편집자에게 보이지 않는다)
function getConnection() {
  const p = PropertiesService.getUserProperties();
  return { token: p.getProperty("token"), port: Number(p.getProperty("port")) || 3939 };
}
function saveConnection(token, port) {
  PropertiesService.getUserProperties().setProperties({ token: String(token).trim(), port: String(port || 3939) });
  return getConnection();
}
function resetKey() {
  PropertiesService.getUserProperties().deleteProperty("token");
  SpreadsheetApp.getUi().alert("연결 키를 지웠습니다. 확장 프로그램 > Local Agent > 열기에서 다시 입력하세요.");
}

// ── 주소와 값 ──
const ss = () => SpreadsheetApp.getActiveSpreadsheet();
function quote(name) { return /^[A-Za-z0-9_]+$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'"; }
function addrOf(r) { return quote(r.getSheet().getName()) + "!" + r.getA1Notation(); }
function rangeOf(addr) {
  if (!addr) return ss().getActiveSheet().getActiveRange();
  return addr.indexOf("!") >= 0 ? ss().getRange(addr) : ss().getActiveSheet().getRange(addr);
}
function sheetOf(name) {
  const s = name ? ss().getSheetByName(name) : ss().getActiveSheet();
  if (!s) throw new Error("시트가 없습니다: " + name);
  return s;
}
// google.script.run은 Date를 넘기지 못하므로 문자열로 바꾼다
function plain(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ss().getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss").replace(" 00:00:00", "");
  return v;
}
const plainGrid = (g) => g.map((row) => row.map(plain));
function dims(grid) { return { rows: grid.length, cols: Math.max(0, ...grid.map((r) => r.length)) }; }
function pad(grid, cols) { return grid.map((r) => r.concat(Array(Math.max(0, cols - r.length)).fill("")).map((v) => (v === null || v === undefined ? "" : v))); }

// 되돌리기용 값·수식 사본. 사이드바가 보관했다가 restore로 돌려준다
function snap(r, undo) {
  if (!undo) return;
  if (r.getNumRows() * r.getNumColumns() > MAX_UNDO_CELLS) { undo.partial = true; return; }
  const f = r.getFormulas(), v = r.getValues();
  undo.items.push({ sheet: r.getSheet().getName(), a1: r.getA1Notation(),
    cells: v.map((row, i) => row.map((x, j) => (f[i][j] ? { f: f[i][j] } : x instanceof Date ? { d: x.toISOString() } : { v: x }))) });
}
function restore(items) {
  let skipped = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i], sh = ss().getSheetByName(it.sheet);
    if (!sh) { skipped++; continue; }
    sh.getRange(it.a1).setValues(it.cells.map((row) => row.map((c) => (c.f !== undefined ? c.f : c.d !== undefined ? new Date(c.d) : c.v))));
  }
  return { ok: true, ranges: items.length - skipped, skipped };
}

function listSheets() {
  const active = ss().getActiveSheet().getName();
  return {
    activeSheet: active,
    sheets: ss().getSheets().map((s) => {
      const rows = s.getLastRow(), cols = s.getLastColumn();
      return { name: s.getName(), hidden: s.isSheetHidden(), usedRange: rows ? quote(s.getName()) + "!" + s.getDataRange().getA1Notation() : null,
        rows, cols, tables: s.getBandings().map((b) => b.getRange().getA1Notation()), charts: s.getCharts().map((c, i) => "차트" + (i + 1)) };
    }),
  };
}
function selection() {
  const r = ss().getActiveRange();
  return r ? addrOf(r) : null;
}

const CHART = { ColumnClustered: "COLUMN", ColumnStacked: "COLUMN", BarClustered: "BAR", Line: "LINE", LineMarkers: "LINE", Pie: "PIE", Doughnut: "PIE", Area: "AREA", XYScatter: "SCATTER" };

const TOOLS = {
  get_workbook_info() { return Object.assign({ ok: true }, listSheets(), { selection: selection() }); },

  read_range({ range, maxCells = 2000 }) {
    const r = rangeOf(range), rows = r.getNumRows(), cols = r.getNumColumns();
    let t = r, truncated = false;
    if (rows * cols > maxCells) { t = r.offset(0, 0, Math.max(1, Math.floor(maxCells / cols)), Math.min(cols, maxCells)); truncated = true; }
    const formulas = t.getFormulas(), hasFormula = formulas.some((row) => row.some((f) => f));
    return { ok: true, address: addrOf(t), fullAddress: addrOf(r), rows, cols, truncated, values: plainGrid(t.getValues()), formulas: hasFormula ? formulas : undefined };
  },

  write_range({ range, values, formulas, numberFormat }, undo) {
    const grid = formulas || values;
    if (!grid || !grid.length) return { ok: false, error: "values 또는 formulas가 필요합니다" };
    const { rows, cols } = dims(grid);
    if (!cols) return { ok: false, error: "빈 배열입니다" };
    const r = rangeOf(range).offset(0, 0, rows, cols); // 시작 셀만 주거나 크기가 달라도 배열 크기에 맞춘다
    snap(r, undo);
    if (numberFormat) r.setNumberFormat(numberFormat);
    r.setValues(pad(grid, cols)); // '='로 시작하는 문자열은 수식으로 들어간다
    r.activate();
    return { ok: true, changedRange: addrOf(r), cells: rows * cols };
  },

  format_range(a) {
    const r = rangeOf(a.range);
    if (a.bold !== undefined) r.setFontWeight(a.bold ? "bold" : "normal");
    if (a.italic !== undefined) r.setFontStyle(a.italic ? "italic" : "normal");
    if (a.fontColor) r.setFontColor(a.fontColor);
    if (a.fontSize) r.setFontSize(a.fontSize);
    if (a.fillColor) r.setBackground(a.fillColor === "none" ? null : a.fillColor);
    if (a.horizontalAlignment) r.setHorizontalAlignment(a.horizontalAlignment === "General" ? null : a.horizontalAlignment.toLowerCase());
    if (a.wrapText !== undefined) r.setWrap(a.wrapText);
    if (a.numberFormat) r.setNumberFormat(a.numberFormat);
    if (a.borders) r.setBorder(true, true, true, true, true, true, "#BFBFBF", SpreadsheetApp.BorderStyle.SOLID);
    const sh = r.getSheet();
    if (a.columnWidth) sh.setColumnWidths(r.getColumn(), r.getNumColumns(), Math.round(a.columnWidth / 0.75)); // 포인트 → 픽셀
    if (a.autofitColumns) sh.autoResizeColumns(r.getColumn(), r.getNumColumns());
    return { ok: true, formattedRange: addrOf(r) };
  },

  manage_sheet({ action, name, names, newName }) {
    const targets = names && names.length ? names : name ? [name] : [];
    if (!targets.length) return { ok: false, error: "name 또는 names가 필요합니다" };
    let existed;
    if (action === "add") {
      const ex = ss().getSheetByName(targets[0]);
      existed = !!ex;
      (ex || ss().insertSheet(targets[0])).activate();
    } else if (action === "rename") { const s = sheetOf(targets[0]); s.setName(newName); s.activate(); }
    else if (action === "activate") sheetOf(targets[0]).activate();
    else if (action === "delete") targets.forEach((n) => ss().deleteSheet(sheetOf(n)));
    else if (action === "hide") targets.forEach((n) => sheetOf(n).hideSheet());
    else if (action === "unhide") targets.forEach((n) => sheetOf(n).showSheet());
    const after = listSheets();
    return { ok: true, action, targets, existed, activeSheet: after.activeSheet, sheets: after.sheets.map((s) => s.name + (s.hidden ? " (숨김)" : "")) };
  },

  // Sheets에는 Excel 표가 없으므로 머리글 굵게·줄무늬·필터로 같은 모양을 만든다
  create_table({ range, hasHeaders = true }) {
    const r = rangeOf(range), sh = r.getSheet();
    if (hasHeaders) r.offset(0, 0, 1).setFontWeight("bold");
    r.getBandings().forEach((b) => b.remove());
    r.applyRowBanding(SpreadsheetApp.BandingTheme.BLUE, hasHeaders, false);
    if (!sh.getFilter()) r.createFilter();
    return { ok: true, table: r.getA1Notation(), range: addrOf(r), note: "Sheets에서는 줄무늬와 필터로 표를 만들었습니다" };
  },

  create_chart({ sourceRange, type = "ColumnClustered", title, anchorCell, seriesBy = "Auto" }) {
    const r = rangeOf(sourceRange), sh = r.getSheet();
    const anchor = anchorCell ? sh.getRange(anchorCell) : sh.getRange(r.getRow(), r.getLastColumn() + 2);
    let b = sh.newChart().setChartType(Charts.ChartType[CHART[type] || "COLUMN"]).addRange(r).setNumHeaders(1)
      .setPosition(anchor.getRow(), anchor.getColumn(), 0, 0).setOption("width", 640).setOption("height", 384);
    if (title) b = b.setOption("title", title);
    if (type === "ColumnStacked") b = b.setOption("isStacked", true);
    if (type === "LineMarkers") b = b.setOption("pointSize", 5);
    if (type === "Doughnut") b = b.setOption("pieHole", 0.5);
    if (seriesBy === "Rows") b = b.setTransposeRowsAndColumns(true);
    sh.insertChart(b.build());
    return { ok: true, chart: "차트" + sh.getCharts().length, sheet: sh.getName() };
  },

  clear_range({ range, what = "contents" }, undo) {
    const r = rangeOf(range);
    snap(r, undo);
    if (what === "contents") r.clearContent(); else if (what === "formats") r.clearFormat(); else r.clear();
    return { ok: true, clearedRange: addrOf(r) };
  },

  run_script({ code }) {
    const result = new Function("ss", "SpreadsheetApp", '"use strict";\n' + code)(ss(), SpreadsheetApp);
    return { ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result, (k, v) => (v instanceof Date ? plain(v) : v))) };
  },
};

TOOLS.batch = function ({ ops }, undo) {
  const results = [];
  for (let i = 0; i < ops.length; i++) {
    const r = runOne(ops[i].tool, ops[i].args, undo);
    results.push(Object.assign({ tool: ops[i].tool }, r));
    if (r.ok === false) return { ok: false, error: (i + 1) + "번째 작업(" + ops[i].tool + ") 실패: " + r.error, done: i, results };
  }
  return { ok: true, done: ops.length, results };
};

function runOne(name, args, undo) {
  if (!TOOLS[name]) return { ok: false, error: "알 수 없는 도구: " + name };
  try { return TOOLS[name](args || {}, undo); } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// 사이드바가 부른다. 값·수식이 바뀐 범위의 사본을 _undo로 함께 돌려준다
function runTool(name, args) {
  const undo = { items: [] };
  const res = runOne(name, args, undo);
  if (undo.items.length || undo.partial) res._undo = undo;
  SpreadsheetApp.flush();
  return res;
}

// 요청과 함께 보내는 상황: 시트 구조는 항상, 선택 범위 값은 칩이 켜져 있을 때만 (최대 300셀)
function readContext(withSelection) {
  const info = listSheets(), out = { host: "sheets", activeSheet: info.activeSheet, sheets: info.sheets };
  if (!withSelection) return out;
  const r = ss().getActiveRange();
  if (!r) return out;
  out.selection = addrOf(r);
  const rows = r.getNumRows(), cols = r.getNumColumns();
  if (rows * cols > 1) {
    const c = Math.min(cols, 30), n = Math.max(1, Math.min(rows, Math.floor(300 / c)));
    out.preview = plainGrid(r.offset(0, 0, n, c).getValues());
    out.previewTruncated = n < rows || c < cols;
  }
  return out;
}
