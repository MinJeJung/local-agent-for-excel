// 구독 전용 실행: 엔진에 API 키·게이트웨이 변수가 넘어가지 않아야 한다
import test from "node:test";
import assert from "node:assert/strict";
import { engineEnv } from "../server/engines.mjs";

const env = { PATH: "/bin", ANTHROPIC_API_KEY: "a", ANTHROPIC_BASE_URL: "b", OPENAI_API_KEY: "c", CODEX_API_KEY: "d" };

test("기본값은 API 키와 게이트웨이 주소를 뺀다", () => {
  const c = engineEnv("claude", { env, token: "t" }), x = engineEnv("codex", { env, token: "t" });
  assert.equal(c.ANTHROPIC_API_KEY, undefined); assert.equal(c.ANTHROPIC_BASE_URL, undefined); assert.equal(c.PATH, "/bin");
  assert.equal(x.OPENAI_API_KEY, undefined); assert.equal(x.CODEX_API_KEY, undefined); assert.equal(x.LOCALXL_TOKEN, "t");
  assert.equal(env.ANTHROPIC_API_KEY, "a"); // 원본 환경은 바꾸지 않는다
});

test("allowApiKey면 그대로 둔다", () => {
  assert.equal(engineEnv("claude", { env, allowApiKey: true }).ANTHROPIC_API_KEY, "a");
});
