import { describe, it, expect } from "vitest";
import { toOverridePayload } from "@/app/(app)/admin/users/[id]/_components/override-panel";
import { toCreateUserPayload } from "@/app/(app)/admin/users/new/_components/create-user-form";

describe("override 폼 페이로드 변환", () => {
  it("빈 startsAt/endsAt/reason은 null로 정규화하고 권한키를 resource/action으로 분해한다", () => {
    expect(toOverridePayload({ permissionKey: "leave.approval:view", effect: "ALLOW", scope: "all", reason: "", startsAt: "", endsAt: "" }))
      .toEqual({ resource: "leave.approval", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null });
  });
  it("값이 있으면 ISO 문자열로 보낸다", () => {
    const p = toOverridePayload({ permissionKey: "admin.users:view", effect: "DENY", scope: "all", reason: "임시 회수", startsAt: "2026-07-01", endsAt: "2026-07-31" });
    expect(p.resource).toBe("admin.users");
    expect(p.action).toBe("view");
    expect(p.effect).toBe("DENY");
    expect(p.startsAt).toBe("2026-07-01T00:00:00.000+09:00");
    expect(p.endsAt).toBe("2026-07-31T23:59:59.999+09:00");
    expect(p.reason).toBe("임시 회수");
  });
});

describe("직접추가 폼 페이로드 변환 (finding 3 — 비번 필드 계약)", () => {
  const state = {
    email: "n@x.com", name: "신규", password: "abcdefghijkl", department: "",
    employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const,
    systemRole: "MEMBER" as const, roleKeys: ["regular-developer"],
  };
  it("비번 필드는 `password`로 보낸다(adminCreateSchema 일치) — tempPassword/temporaryPassword 키 금지", () => {
    const p = toCreateUserPayload(state) as Record<string, unknown>;
    expect(p.password).toBe("abcdefghijkl");
    expect(p).not.toHaveProperty("tempPassword");
    expect(p).not.toHaveProperty("temporaryPassword");
  });
  it("빈 department는 null로 정규화한다", () => {
    expect(toCreateUserPayload(state).department).toBeNull();
    expect(toCreateUserPayload({ ...state, department: "플랫폼" }).department).toBe("플랫폼");
  });
});
