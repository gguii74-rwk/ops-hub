import { describe, it, expect } from "vitest";
import { authConfig } from "@/lib/auth/config";

// authorized 콜백은 Edge-safe(string 비교만). 최소 NextAuth 타입 형태로 테스트.
const authorized = authConfig.callbacks!.authorized!;

function makeArgs(pathname: string, authed: boolean) {
  return {
    auth: authed ? ({ user: { id: "u1" } } as Parameters<typeof authorized>[0]["auth"]) : null,
    request: { nextUrl: { pathname } } as unknown as Parameters<typeof authorized>[0]["request"],
  };
}

describe("authConfig.callbacks.authorized — 공개경로 게이트", () => {
  it("/login은 비인증 접근 허용", () => {
    expect(authorized(makeArgs("/login", false))).toBe(true);
  });

  it("/signup은 비인증 접근 허용(F1 — task-08 페이지 등록 의존)", () => {
    expect(authorized(makeArgs("/signup", false))).toBe(true);
  });

  it("/verify-email은 비인증 접근 허용(F1)", () => {
    expect(authorized(makeArgs("/verify-email", false))).toBe(true);
  });

  it("/api/auth/* 경로는 비인증 허용", () => {
    expect(authorized(makeArgs("/api/auth/session", false))).toBe(true);
  });

  it("/admin 등 일반 경로는 비인증 거부", () => {
    expect(authorized(makeArgs("/admin", false))).toBe(false);
  });

  it("인증된 사용자는 /admin 접근 가능", () => {
    expect(authorized(makeArgs("/admin", true))).toBe(true);
  });
});
