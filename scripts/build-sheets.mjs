// Google Sheets 사이드바(sheets/Sidebar.html)를 Excel 작업창 화면에서 만든다. 화면 코드는 하나만 유지한다.
// 사용: node scripts/build-sheets.mjs [출력 폴더]  (기본: sheets/build)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || path.join(root, "sheets", "build"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const dataUri = (p) => "data:image/png;base64," + fs.readFileSync(path.join(root, p)).toString("base64");
// HtmlService는 스크립트 줄에서 // 뒤를 주석으로 보고 지운다. 문자열 안의 ://도 잘리므로 미리 막는다
const inline = (js) => {
  if (/:\/\//.test(js)) throw new Error("사이드바 스크립트에 :// 가 있습니다. :\\/\\/ 로 나눠 쓰세요.");
  return "<script>\n" + js.replace(/<\/(script)/gi, "<\\/$1") + "\n</script>";
};

let html = read("taskpane/index.html");
const swap = (a, b) => { if (!html.includes(a)) throw new Error("화면에서 찾지 못함: " + a); html = html.split(a).join(b); };
swap('<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>\n', "");
swap("<title>Local Agent for Excel</title>", "<title>Local Agent for Sheets</title>");
swap("이 통합 문서에", "이 스프레드시트에");
swap('placeholder="Excel 작업을 요청하세요"', 'placeholder="시트 작업을 요청하세요"');
swap('src="assets/icon-32.png"', `src="${dataUri("taskpane/assets/icon-32.png")}"`);
swap('src="assets/icon-64.png"', `src="${dataUri("taskpane/assets/icon-64.png")}"`);
swap("</style>", `  .keybox { margin: auto; max-width: 420px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
  .keybox p { margin: 0; color: var(--sub); word-break: keep-all; }
  .keybox code { background: var(--bubble); padding: 1px 5px; border-radius: 5px; font: 11.5px ui-monospace, Menlo, monospace; word-break: break-all; }
  .keybox input { padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; }
  .keybox button { align-self: flex-end; padding: 5px 14px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; }
</style>`);
swap('<script src="excel-tools.js"></script>\n<script src="app.js"></script>', inline(read("sheets/client.js")) + "\n" + inline(read("taskpane/app.js")));

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "Sidebar.html"), html);
for (const f of ["Code.js", "appsscript.json"]) fs.copyFileSync(path.join(root, "sheets", f), path.join(out, f));
console.log(out);
