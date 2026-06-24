import { describe, it, expect } from "vitest";
import {
  STATUS_LABEL, STATUS_VARIANT, EMPLOYMENT_LABEL, JOB_LABEL, SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS, ROLE_OPTIONS,
  STATUS_TONE, EMPLOYMENT_TONE, JOB_TONE, ROLE_LABEL, ROLE_TONE, roleLabel, roleTone,
} from "@/app/(app)/admin/users/_components/labels";

describe("user 관리 라벨 상수", () => {
  it("UserStatus 5값이 모두 라벨·variant를 가진다", () => {
    for (const s of ["PENDING", "INVITED", "ACTIVE", "DISABLED", "REJECTED"] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_VARIANT[s]).toBeTruthy();
    }
  });
  it("고용형태·직무·systemRole 라벨이 enum을 덮는다", () => {
    expect(Object.keys(EMPLOYMENT_LABEL)).toEqual(["REGULAR", "CONTRACTOR"]);
    expect(Object.keys(JOB_LABEL)).toEqual(["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"]);
    expect(Object.keys(SYSTEM_ROLE_LABEL)).toEqual(["OWNER", "ADMIN", "MANAGER", "MEMBER"]); // LABEL은 기존 MANAGER 사용자 표시용으로 유지
  });
  it("SYSTEM_ROLE_OPTIONS(부여 선택지)는 MANAGER를 제외한다(MANAGER 폐지)", () => {
    expect(SYSTEM_ROLE_OPTIONS).toEqual(["OWNER", "ADMIN", "MEMBER"]);
  });
  it("특권 역할(pm·admin)은 privileged=true로 표시된다", () => {
    const priv = ROLE_OPTIONS.filter((r) => r.privileged).map((r) => r.key).sort();
    expect(priv).toEqual(["admin", "pm"]);
  });
});

describe("presentation tone maps", () => {
  it("STATUS_TONE covers every STATUS_LABEL key", () => {
    for (const k of Object.keys(STATUS_LABEL)) expect(STATUS_TONE[k as keyof typeof STATUS_TONE]).toBeTruthy();
    expect(STATUS_TONE.ACTIVE).toBe("ok");
    expect(STATUS_TONE.REJECTED).toBe("rose");
    expect(STATUS_TONE.DISABLED).toBe("off");
  });
  it("EMPLOYMENT_TONE / JOB_TONE cover their label keys", () => {
    for (const k of Object.keys(EMPLOYMENT_LABEL)) expect(EMPLOYMENT_TONE[k as keyof typeof EMPLOYMENT_TONE]).toBeTruthy();
    for (const k of Object.keys(JOB_LABEL)) expect(JOB_TONE[k as keyof typeof JOB_TONE]).toBeTruthy();
    expect(EMPLOYMENT_TONE.CONTRACTOR).toBe("amber");
    expect(JOB_TONE.CONTENT_MANAGER).toBe("purple");
  });
});

describe("role label/tone", () => {
  it("ROLE_LABEL is derived from ROLE_OPTIONS", () => {
    for (const o of ROLE_OPTIONS) expect(ROLE_LABEL[o.key]).toBe(o.label);
  });
  it("roleLabel falls back to the raw key", () => {
    expect(roleLabel("regular-developer")).toBe(ROLE_LABEL["regular-developer"]);
    expect(roleLabel("unknown-key")).toBe("unknown-key");
  });
  it("roleTone maps known roles and defaults to neutral", () => {
    expect(roleTone("pm")).toBe("pink");
    expect(roleTone("admin")).toBe("rose");
    expect(roleTone("contractor-content")).toBe("purple");
    expect(roleTone("contractor-civil-response")).toBe("orange");
    expect(roleTone("regular-developer")).toBe("blue");
    expect(roleTone("contractor-developer")).toBe("blue");
    expect(roleTone("nope")).toBe("neutral");
  });
});
