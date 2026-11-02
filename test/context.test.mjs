// 상황 머리: 호스트에 따라 Excel·Google Sheets를 구분한다
import test from "node:test";
import assert from "node:assert/strict";
import { contextLine } from "../server/engines.mjs";

const ctx = { activeSheet: "Sheet1", sheets: [{ name: "Sheet1", usedRange: "Sheet1!A1:B2" }] };

test("Excel은 [Excel 상황]", () => {
  assert.match(contextLine(ctx), /^\[Excel 상황\]\n활성 시트: Sheet1/);
});

test("Sheets는 [Google Sheets 상황]과 Apps Script 안내", () => {
  const s = contextLine({ ...ctx, host: "sheets" });
  assert.match(s, /^\[Google Sheets 상황\] run_script는 Apps Script/);
  assert.match(s, /Sheet1\(A1:B2\)/);
});

test("빈 상황은 빈 문자열", () => {
  assert.equal(contextLine({ host: "sheets" }), "");
});
