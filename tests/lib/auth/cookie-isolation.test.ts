import { describe, it, expect } from "vitest";
import { authConfig } from "@/lib/auth/config";

// 회귀(2026-06-22): day-sync(:3100)와 ops-hub(:3200)가 같은 호스트(IP)에서 돌고, 쿠키는 포트를 구분하지 않아
// 둘 다 기본 이름 `authjs.session-token`을 쓰면 세션 쿠키가 서로 덮어써졌다. 다른 시크릿으로 암호화된 쿠키를
// 받으면 "no matching decryption secret"으로 세션이 깨지고, 레이아웃이 session.user.id 없이 크래시했다.
// → ops-hub 전용 쿠키 이름을 강제한다(기본 authjs.* 이면 충돌).
describe("쿠키 이름 격리 (같은 호스트 cross-app 충돌 방지)", () => {
  it("sessionToken 쿠키 이름이 ops-hub 전용이고 기본 authjs 이름이 아니다", () => {
    const name = authConfig.cookies?.sessionToken?.name;
    expect(name).toBeDefined();
    expect(name).toContain("ops-hub");
    expect(name).not.toContain("authjs.session-token");
  });

  it("csrfToken·callbackUrl 쿠키 이름도 ops-hub 전용", () => {
    expect(authConfig.cookies?.csrfToken?.name).toContain("ops-hub");
    expect(authConfig.cookies?.callbackUrl?.name).toContain("ops-hub");
  });

  it("미들웨어(authConfig)와 서버 인스턴스가 동일 쿠키 설정을 공유해야 하므로 cookies는 authConfig에 있다", () => {
    expect(authConfig.cookies).toBeDefined();
  });
});
