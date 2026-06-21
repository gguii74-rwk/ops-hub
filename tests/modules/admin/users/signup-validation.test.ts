import { describe, it, expect } from "vitest";
import { signupSchema, setPasswordSchema, resendSchema } from "@/modules/admin/users/validations/signup";

describe("signupSchema (비번 없음)", () => {
  it("유효 입력 통과 — email·name·employmentType·jobFunction·department", () => {
    const r = signupSchema.safeParse({ email: "a@x.com", name: "홍길동", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: "개발팀" });
    expect(r.success).toBe(true);
  });
  it("password 필드는 받지 않는다(있어도 무시 — strip)", () => {
    const r = signupSchema.safeParse({ email: "a@x.com", name: "n", employmentType: "REGULAR", jobFunction: "PM", department: null, password: "should-be-ignored" });
    expect(r.success).toBe(true);
    expect("password" in (r as { data: object }).data).toBe(false);
  });
  it("잘못된 enum은 거부", () => {
    expect(signupSchema.safeParse({ email: "a@x.com", name: "n", employmentType: "X", jobFunction: "DEVELOPER", department: null }).success).toBe(false);
  });
  it("이메일 형식 아니면 거부", () => {
    expect(signupSchema.safeParse({ email: "not-email", name: "n", employmentType: "REGULAR", jobFunction: "PM", department: null }).success).toBe(false);
  });
});

describe("setPasswordSchema (token + 12자+)", () => {
  it("token·12자+ 통과", () => {
    expect(setPasswordSchema.safeParse({ token: "abc", password: "123456789012" }).success).toBe(true);
  });
  it("12자 미만 비번 거부", () => {
    expect(setPasswordSchema.safeParse({ token: "abc", password: "short" }).success).toBe(false);
  });
  it("token 누락 거부", () => {
    expect(setPasswordSchema.safeParse({ password: "123456789012" }).success).toBe(false);
  });
});

describe("resendSchema (email)", () => {
  it("이메일 통과", () => {
    expect(resendSchema.safeParse({ email: "a@x.com" }).success).toBe(true);
  });
});
