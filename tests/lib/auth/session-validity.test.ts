import { describe, it, expect } from "vitest";
import { isSessionValid } from "@/lib/auth/session-validity";

const ISSUED = new Date("2026-06-10T00:00:00Z").getTime(); // token.iatMs(ms 정밀)

describe("isSessionValid — 세션 무효 판정(순수)", () => {
  it("ACTIVE·무효화 시각 없음 → 유효", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: null })).toBe(true);
  });
  it("status가 DISABLED면 무효", () => {
    expect(isSessionValid(ISSUED, { status: "DISABLED", passwordChangedAt: null, sessionInvalidatedAt: null })).toBe(false);
  });
  it("passwordChangedAt이 발급시각 이후면 무효(비번변경 타 세션 무효화)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-11T00:00:00Z"), sessionInvalidatedAt: null })).toBe(false);
  });
  it("sessionInvalidatedAt이 발급시각 이후면 무효(비활성화/재설정)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: new Date("2026-06-11T00:00:00Z") })).toBe(false);
  });
  it("무효화 시각이 모두 발급시각 이전이면 유효(이 세션이 더 최신)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-09T00:00:00Z"), sessionInvalidatedAt: new Date("2026-06-09T00:00:00Z") })).toBe(true);
  });
  it("무효화 시각이 발급시각과 정확히 같으면 무효(revocation 우선 `>=` — 동일 ms 동시 reset/disable는 revoke)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-10T00:00:00Z"), sessionInvalidatedAt: null })).toBe(false);
  });

  // 통합리뷰 finding(같은-초 lockout): ms 정밀 발급시각이라 같은 초 내 비번변경+재로그인을 정확히 구분한다.
  // 초 단위 iat였다면 둘 다 같은 초로 절단돼 fresh 토큰이 잘못 무효화됐다(lockout).
  describe("같은-초 ms 정밀 — fresh/stale 토큰 구분", () => {
    const second = new Date("2026-06-10T10:00:00Z").getTime(); // 초 경계
    const pwChanged = new Date(second + 800); // 10:00:00.800 비번변경
    it("fresh 토큰(비번변경 이후 .900 발급) → 유효(lockout 없음)", () => {
      expect(isSessionValid(second + 900, { status: "ACTIVE", passwordChangedAt: pwChanged, sessionInvalidatedAt: null })).toBe(true);
    });
    it("stale 토큰(비번변경 이전 .100 발급) → 무효(같은 초여도 ms로 구분해 무효화)", () => {
      expect(isSessionValid(second + 100, { status: "ACTIVE", passwordChangedAt: pwChanged, sessionInvalidatedAt: null })).toBe(false);
    });
  });
});
