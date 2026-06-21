import { describe, expect, it } from "vitest";
import {
  assertNotSelfMutation,
  assertCanAssignRoles,
  assertCanSetSystemRole,
  assertOverrideWithinActorGrant,
  type ActorContext,
} from "@/modules/admin/users/services/guards";
import { EscalationError } from "@/modules/admin/users/errors";

const owner = (id = "owner1"): ActorContext => ({ userId: id, isOwner: true, permissionKeys: new Set() });
const delegate = (keys: string[], id = "admin1"): ActorContext => ({
  userId: id, isOwner: false, permissionKeys: new Set(keys),
});

describe("assertNotSelfMutation (D13ⓐ)", () => {
  it("비-OWNER가 자기 자신 mutation → EscalationError", () => {
    expect(() => assertNotSelfMutation(delegate([], "u1"), "u1")).toThrow(EscalationError);
  });
  it("비-OWNER가 타인 mutation → 허용", () => {
    expect(() => assertNotSelfMutation(delegate([], "u1"), "u2")).not.toThrow();
  });
  it("OWNER는 자기 자신도 허용", () => {
    expect(() => assertNotSelfMutation(owner("u1"), "u1")).not.toThrow();
  });
});

describe("assertCanAssignRoles (D13ⓑ — 현재↔원하는 역할 집합 비교)", () => {
  it("비-OWNER가 특권 역할(pm) 추가 → EscalationError", () => {
    expect(() => assertCanAssignRoles(delegate([]), ["regular-developer"], ["regular-developer", "pm"])).toThrow(EscalationError);
  });
  it("비-OWNER가 특권 역할(admin) 추가 → EscalationError", () => {
    expect(() => assertCanAssignRoles(delegate([]), [], ["admin"])).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 특권 역할(pm)을 목록에서 빼서 제거 → EscalationError(lockout 방지)", () => {
    // 현재 pm 보유 → next 목록에서 누락 = 제거. 추가가 아니어도 특권이 건드려지면 OWNER-only.
    expect(() => assertCanAssignRoles(delegate([]), ["regular-developer", "pm"], ["regular-developer"])).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 특권 역할(admin)을 제거 → EscalationError", () => {
    expect(() => assertCanAssignRoles(delegate([]), ["admin"], [])).toThrow(EscalationError);
  });
  it("비-OWNER가 비특권 역할만 추가·제거 → 허용", () => {
    // 현재 [regular-developer] → next [contractor-content]: 추가·제거 모두 비특권.
    expect(() => assertCanAssignRoles(delegate([]), ["regular-developer"], ["contractor-content"])).not.toThrow();
  });
  it("비-OWNER가 특권 역할(pm)을 그대로 유지(추가·제거 없음) → 허용(차집합 비어 있음)", () => {
    // 현재·next 모두 pm 보유 → 특권 역할이 건드려지지 않았으므로 허용.
    expect(() => assertCanAssignRoles(delegate([]), ["pm", "regular-developer"], ["pm", "contractor-content"])).not.toThrow();
  });
  it("OWNER는 특권 역할 추가·제거 모두 허용", () => {
    expect(() => assertCanAssignRoles(owner(), [], ["pm", "admin"])).not.toThrow();
    expect(() => assertCanAssignRoles(owner(), ["pm", "admin"], [])).not.toThrow();
  });
});

describe("assertCanSetSystemRole (D12 — 현재·원하는 systemRole 모두 검사)", () => {
  it("비-OWNER가 OWNER 부여 → EscalationError", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", "OWNER")).toThrow(EscalationError);
  });
  it("비-OWNER가 ADMIN 부여 → EscalationError", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", "ADMIN")).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 OWNER를 MEMBER로 강등 → EscalationError(현재가 특권이면 OWNER-only)", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "OWNER", "MEMBER")).toThrow(EscalationError);
  });
  it("비-OWNER가 기존 ADMIN을 MANAGER로 강등 → EscalationError", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "ADMIN", "MANAGER")).toThrow(EscalationError);
  });
  it("비-OWNER가 비특권↔비특권 변경(MEMBER→MANAGER) → 허용", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", "MANAGER")).not.toThrow();
    expect(() => assertCanSetSystemRole(delegate([]), "MANAGER", "MEMBER")).not.toThrow();
  });
  it("newRole null(변경 없음)이고 현재도 비특권 → 허용", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "MEMBER", null)).not.toThrow();
  });
  it("newRole null(변경 없음)이지만 현재가 특권(ADMIN)이면 → EscalationError(가용성 영향 mutation 차단)", () => {
    expect(() => assertCanSetSystemRole(delegate([]), "ADMIN", null)).toThrow(EscalationError);
  });
  it("OWNER는 강등·승격 모두 허용", () => {
    expect(() => assertCanSetSystemRole(owner(), "MEMBER", "OWNER")).not.toThrow();
    expect(() => assertCanSetSystemRole(owner(), "OWNER", "MEMBER")).not.toThrow();
  });
});

describe("assertOverrideWithinActorGrant (D13ⓒⓓ — critical은 effect 무관 OWNER-only)", () => {
  it("ALLOW: 비-critical actor 보유 권한이면 허용", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["leave.approval:approve"]), "leave.approval:approve", "ALLOW"),
    ).not.toThrow();
  });
  it("ALLOW: 비-critical actor 미보유 권한이면 EscalationError(가진 것 이상 못 줌)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate([]), "leave.approval:approve", "ALLOW"),
    ).toThrow(EscalationError);
  });
  it("DENY: 비-critical 권한은 위임 admin 허용", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate([]), "leave.approval:approve", "DENY"),
    ).not.toThrow();
  });
  it("ALLOW: critical(admin.users:update)은 actor가 보유하고 있어도 비-OWNER 거부(finding D — 경계 우회 방지)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["admin.users:update"]), "admin.users:update", "ALLOW"),
    ).toThrow(EscalationError);
  });
  it("ALLOW: critical(admin.audit:view)은 actor가 보유하고 있어도 비-OWNER 거부(finding D)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["admin.audit:view"]), "admin.audit:view", "ALLOW"),
    ).toThrow(EscalationError);
  });
  it("DENY: critical(admin.*) 권한은 비-OWNER 거부(lockout 방지)", () => {
    expect(() =>
      assertOverrideWithinActorGrant(delegate(["admin.users:update"]), "admin.users:update", "DENY"),
    ).toThrow(EscalationError);
  });
  it("OWNER는 critical ALLOW·critical DENY·비-critical 미보유 ALLOW 모두 허용", () => {
    expect(() => assertOverrideWithinActorGrant(owner(), "admin.users:update", "ALLOW")).not.toThrow();
    expect(() => assertOverrideWithinActorGrant(owner(), "admin.users:update", "DENY")).not.toThrow();
    expect(() => assertOverrideWithinActorGrant(owner(), "admin.audit:view", "ALLOW")).not.toThrow();
    expect(() => assertOverrideWithinActorGrant(owner(), "leave.approval:approve", "ALLOW")).not.toThrow();
  });
});
