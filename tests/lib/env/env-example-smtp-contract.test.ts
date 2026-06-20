import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// .env.example과 코드가 읽는 SMTP 키가 어긋나면 예제대로 배포한 환경에서 메일 인증이 조용히 실패한다
// (transport는 SMTP_PASSWORD를 읽음 — src/lib/integrations/mail/index.ts, env schema, integrations/status).
const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

describe(".env.example SMTP 키 계약", () => {
  it("코드가 읽는 SMTP_PASSWORD를 노출한다", () => {
    expect(envExample).toMatch(/^SMTP_PASSWORD=/m);
  });
  it("코드가 읽지 않는 레거시 SMTP_PASS 키를 노출하지 않는다", () => {
    expect(envExample).not.toMatch(/^SMTP_PASS=/m);
  });
});
