import { describe, it, expect } from "vitest";
import { isSessionValid } from "@/lib/auth/session-validity";

const ISSUED = Math.floor(new Date("2026-06-10T00:00:00Z").getTime() / 1000); // token.iat(초)

describe("isSessionValid — 세션 무효 판정(순수)", () => {
  it("ACTIVE·무효화 시각 없음 → 유효", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: null })).toBe(true);
  });
  it("status가 DISABLED면 무효", () => {
    expect(isSessionValid(ISSUED, { status: "DISABLED", passwordChangedAt: null, sessionInvalidatedAt: null })).toBe(false);
  });
  it("passwordChangedAt이 iat 이후면 무효(비번변경 타 세션 무효화)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-11T00:00:00Z"), sessionInvalidatedAt: null })).toBe(false);
  });
  it("sessionInvalidatedAt이 iat 이후면 무효(비활성화/재설정)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: new Date("2026-06-11T00:00:00Z") })).toBe(false);
  });
  it("무효화 시각이 모두 iat 이전이면 유효(이 세션이 더 최신)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-09T00:00:00Z"), sessionInvalidatedAt: new Date("2026-06-09T00:00:00Z") })).toBe(true);
  });
  it("무효화 시각이 iat과 정확히 같으면 유효(strict `>`)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-10T00:00:00Z"), sessionInvalidatedAt: null })).toBe(true);
  });
});
