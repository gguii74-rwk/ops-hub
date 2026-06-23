import { describe, expect, it } from "vitest";
import {
  adminCreateSchema, approveSchema, rejectSchema,
  updateUserSchema, rolesSchema, overrideSchema,
} from "@/modules/admin/users/validations";

// 공개 스키마(signupSchema/setPasswordSchema/resendSchema)는 task-06, changePasswordSchema는 task-07 소관 — 본 task에서 정의·테스트하지 않는다.

describe("approveSchema", () => {
  const ok = { employmentType: "CONTRACTOR", jobFunction: "CONTENT_MANAGER", systemRole: "MEMBER", roleKeys: ["contractor-content"] };
  it("정상 승인 입력 통과", () => {
    expect(approveSchema.safeParse(ok).success).toBe(true);
  });
  it("roleKeys 빈 배열 허용(역할 없이 승인 가능)", () => {
    expect(approveSchema.safeParse({ ...ok, roleKeys: [] }).success).toBe(true);
  });
  it("알 수 없는 systemRole 거부", () => {
    expect(approveSchema.safeParse({ ...ok, systemRole: "ROOT" }).success).toBe(false);
  });
});

describe("rejectSchema", () => {
  it("사유 필수(trim 후 빈 문자열 거부)", () => {
    expect(rejectSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "중복 신청" }).success).toBe(true);
  });
});

describe("adminCreateSchema", () => {
  const ok = {
    email: "n@x.com", name: "신규", password: "abcdefghijkl",
    employmentType: "REGULAR", jobFunction: "DEVELOPER", teamId: null,
    systemRole: "MEMBER", roleKeys: ["regular-developer"],
  };
  it("정상 통과", () => {
    expect(adminCreateSchema.safeParse(ok).success).toBe(true);
  });
  it("임시비번 12자 미만 거부", () => {
    expect(adminCreateSchema.safeParse({ ...ok, password: "short" }).success).toBe(false);
  });
});

describe("updateUserSchema / rolesSchema", () => {
  it("updateUser 부분 patch — 빈 객체도 통과(변경 없음)", () => {
    expect(updateUserSchema.safeParse({}).success).toBe(true);
    expect(updateUserSchema.safeParse({ name: "수정", systemRole: "MANAGER" }).success).toBe(true);
  });
  it("updateUser 알 수 없는 systemRole 거부", () => {
    expect(updateUserSchema.safeParse({ systemRole: "ROOT" }).success).toBe(false);
  });
  it("rolesSchema roleKeys 배열", () => {
    expect(rolesSchema.safeParse({ roleKeys: ["developer", "admin"] }).success).toBe(true);
    expect(rolesSchema.safeParse({ roleKeys: "developer" }).success).toBe(false);
  });
});

describe("overrideSchema (resource:action 키·effect·scope·유효기간)", () => {
  const ok = { resource: "leave.approval", action: "view", effect: "ALLOW", scope: "all", reason: "임시 위임", startsAt: null, endsAt: null };
  it("정상 통과", () => {
    expect(overrideSchema.safeParse(ok).success).toBe(true);
  });
  it("알 수 없는 effect 거부", () => {
    expect(overrideSchema.safeParse({ ...ok, effect: "MAYBE" }).success).toBe(false);
  });
  it("알 수 없는 scope 거부", () => {
    expect(overrideSchema.safeParse({ ...ok, scope: "global" }).success).toBe(false);
  });
  it("ISO datetime 문자열 startsAt/endsAt 허용", () => {
    expect(overrideSchema.safeParse({ ...ok, startsAt: "2026-06-21T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z" }).success).toBe(true);
  });
});
