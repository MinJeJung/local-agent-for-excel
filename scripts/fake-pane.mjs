// 검증용 가짜 작업창: 브리지에 붙어 대화를 보내고, 도구 호출에 가짜 결과를 돌려준다.
// 사용: node scripts/fake-pane.mjs <claude|codex> "<프롬프트>"
import fs from "node:fs"; import os from "node:os"; import WebSocket from "ws";
const cfg = JSON.parse(fs.readFileSync(os.homedir() + "/.localxl/config.json", "utf8"));
const [engine = "claude", prompt = "get_workbook_info로 시트 목록을 확인하고 Sheet1!A1에 '안녕'을 써줘"] = process.argv.slice(2);
const ws = new WebSocket(`ws://localhost:${cfg.port}/ws?token=${cfg.token}&fresh=1`);
ws.on("open", () => ws.send(JSON.stringify({ type: "chat", engine, prompt, ctx: { activeSheet: "Sheet1", selection: "Sheet1!A1" } })));
ws.on("message", (b) => {
  const m = JSON.parse(b);
  if (m.type === "hello") console.log("hello slash:", m.slashCommands.length, "engines:", JSON.stringify(m.engines));
  if (m.type === "tool_call") {
    console.log("TOOL_CALL", m.name, JSON.stringify(m.args).slice(0, 200));
    const r = m.name === "get_workbook_info" ? { ok: true, activeSheet: "Sheet1", sheets: [{ name: "Sheet1", usedRange: null }] } : { ok: true, changedRange: m.args.range };
    ws.send(JSON.stringify({ type: "tool_result", callId: m.callId, ...r }));
  }
  if (m.type === "event") {
    const e = m.ev;
    if (e.type === "text_delta") process.stdout.write(e.text);
    else console.log("\nEV", JSON.stringify(e).slice(0, 300));
    if (e.type === "exit") { ws.send(JSON.stringify({ type: "new_session" })); setTimeout(() => process.exit(0), 300); } // 내 작업창이 이 대화를 잇지 않게
  }
});
