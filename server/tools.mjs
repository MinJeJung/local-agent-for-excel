// excel MCP 도구 정의. 실행은 작업창(Office.js)이 하고, 브리지는 중계만 한다.
import { z } from "zod";

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const grid = z.array(z.array(cell));
const addr = z.string().describe("'시트!A1:C10' 형식. 시트를 빼면 활성 시트");

export const TOOLS = [
  {
    name: "get_workbook_info",
    description: "통합 문서의 시트 목록, 시트별 사용 범위, 표·차트 수, 활성 시트, 현재 선택 범위를 반환한다. 작업 시작 전에 먼저 호출한다.",
    schema: {},
  },
  {
    name: "read_range",
    description: "범위의 값과 수식을 읽는다. maxCells(기본 2000)를 넘으면 앞부분만 반환하고 truncated=true로 알린다.",
    schema: { range: addr, maxCells: z.number().int().optional() },
  },
  {
    name: "write_range",
    description:
      "범위에 값이나 수식을 쓴다. range에 시작 셀(예: 'Sheet1!B2')만 주면 배열 크기만큼 자동으로 넓힌다. '='로 시작하는 문자열은 수식으로 들어간다. 계산 결과는 값 대신 수식으로 쓰는 것을 우선한다.",
    schema: {
      range: addr,
      values: grid.optional().describe("2차원 배열 값"),
      formulas: grid.optional().describe("2차원 배열 수식 (values 대신 사용)"),
      numberFormat: z.string().optional().describe("모든 셀에 적용할 표시 형식, 예: '#,##0', '0.0%', 'yyyy-mm-dd'"),
    },
  },
  {
    name: "format_range",
    description: "범위 서식을 바꾼다. 지정한 항목만 바뀐다.",
    schema: {
      range: addr,
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      fontColor: z.string().optional().describe("#RRGGBB"),
      fillColor: z.string().optional().describe("#RRGGBB, 'none'이면 채우기 제거"),
      fontSize: z.number().optional(),
      numberFormat: z.string().optional(),
      horizontalAlignment: z.enum(["Left", "Center", "Right", "General"]).optional(),
      wrapText: z.boolean().optional(),
      borders: z.boolean().optional().describe("true면 모든 테두리 가는 실선"),
      autofitColumns: z.boolean().optional(),
      columnWidth: z.number().optional().describe("포인트 단위 열 너비"),
    },
  },
  {
    name: "manage_sheet",
    description: "시트를 추가(add), 이름 변경(rename), 활성화(activate), 삭제(delete), 숨김(hide), 숨김 해제(unhide)한다. delete·hide는 names로 여러 개를 한 번에 처리한다. 결과에 작업 후 시트 목록이 들어 있다. 시트 삭제는 Google Sheets에서는 code가 Apps Script 동기 함수 본문이고 ss(현재 스프레드시트)와 SpreadsheetApp을 쓸 수 있다. 예: ss.getSheetByName('Sheet1').getRange('A2:D20').sort({ column: 2, ascending: false }); return 'ok'. 되돌리기로 복구되지 않는다.",
    schema: {
      action: z.enum(["add", "rename", "activate", "delete", "hide", "unhide"]),
      name: z.string().optional(),
      names: z.array(z.string()).optional().describe("delete·hide·unhide 대상 여러 개"),
      newName: z.string().optional(),
    },
  },
  {
    name: "create_table",
    description: "범위를 표로 만든다. Excel은 표(ListObject), Google Sheets는 굵은 머리글·줄무늬·필터를 적용한다.",
    schema: {
      range: addr,
      hasHeaders: z.boolean().default(true),
      name: z.string().optional(),
      style: z.string().optional().describe("예: TableStyleMedium2"),
    },
  },
  {
    name: "create_chart",
    description: "원본 범위로 차트를 만든다. 첫 행·첫 열을 머리글로 본다.",
    schema: {
      sourceRange: addr,
      type: z
        .enum(["ColumnClustered", "ColumnStacked", "BarClustered", "Line", "LineMarkers", "Pie", "Doughnut", "Area", "XYScatter"])
        .default("ColumnClustered"),
      title: z.string().optional(),
      anchorCell: z.string().optional().describe("차트 왼쪽 위 셀, 예: 'H2'. 없으면 원본 오른쪽"),
      seriesBy: z.enum(["Auto", "Columns", "Rows"]).default("Auto"),
    },
  },
  {
    name: "clear_range",
    description: "범위의 내용(contents), 서식(formats) 또는 전부(all)를 지운다. 되돌리기 버튼으로 값·수식은 복구할 수 있다.",
    schema: { range: addr, what: z.enum(["contents", "formats", "all"]).default("contents") },
  },
  {
    name: "run_script",
    description:
      "전용 도구가 없는 작업을 Office.js 코드로 실행한다. code는 async 함수 본문이고 context(Excel.RequestContext)와 Excel을 쓸 수 있다. context.sync()는 직접 부르고, 결과로 돌려줄 값을 return한다. 예: const r = context.workbook.worksheets.getItem('Sheet1').getRange('A1:D20'); r.sort.apply([{ key: 1, ascending: false }], true); await context.sync(); return 'ok'. 되돌리기로 복구되지 않는다.",
    schema: { code: z.string() },
  },
];

const OP_NAMES = TOOLS.map((t) => t.name);
TOOLS.push({
  name: "batch",
  description:
    "여러 excel 도구를 순서대로 한 번에 실행한다. 왕복을 줄이려면 쓰기·서식·표·차트 작업을 묶어 보낸다. 하나가 실패하면 거기서 멈추고 그때까지의 결과를 돌려준다. 예: ops=[{tool:'write_range',args:{range:'Sheet1!A1',values:[[1,2]]}},{tool:'format_range',args:{range:'Sheet1!A1:B1',bold:true}}]",
  schema: {
    ops: z.array(z.object({ tool: z.enum(OP_NAMES), args: z.record(z.string(), z.any()).default({}) })).min(1),
  },
});
