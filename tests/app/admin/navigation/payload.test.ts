import { describe, it, expect } from "vitest";
import {
  toCreatePayload, toUpdatePayload, toReparentPayload, toDeletePayload, hrefWarning, deleteConfirmLabel, PUBLIC_OPTION,
  isLatestRequest,
  type NavFormState,
} from "@/app/(app)/admin/navigation/_components/navigation-editor";

const base: NavFormState = { label: " 메뉴 ", href: "", parentId: "", permissionSelect: "" };

describe("toCreatePayload", () => {
  it("label trim, 빈 href·parentId·미선택권한 → null, 공개 옵션 → null", () => {
    expect(toCreatePayload({ ...base, permissionSelect: PUBLIC_OPTION })).toEqual({
      label: "메뉴", href: null, parentId: null, requiredPermissionId: null,
    });
  });
  it("href·parentId·permissionId 값은 그대로", () => {
    expect(toCreatePayload({ label: "자식", href: "/admin/x", parentId: "p1", permissionSelect: "perm9" })).toEqual({
      label: "자식", href: "/admin/x", parentId: "p1", requiredPermissionId: "perm9",
    });
  });
});

describe("toUpdatePayload", () => {
  it("updatedAt 포함, parentId 없음(이동은 reparent 전용)", () => {
    const p = toUpdatePayload({ ...base, label: "x", permissionSelect: "perm9" }, "2026-06-22T00:00:00.000Z");
    expect(p).toEqual({ label: "x", href: null, requiredPermissionId: "perm9", updatedAt: "2026-06-22T00:00:00.000Z" });
    expect(p).not.toHaveProperty("parentId");
  });
});

describe("toReparentPayload(P8 — 이동)", () => {
  it("빈 부모 → null(대메뉴 승격), 값 있으면 그대로 + updatedAt", () => {
    expect(toReparentPayload({ ...base, parentId: "" }, "2026-06-22T00:00:00.000Z")).toEqual({ newParentId: null, updatedAt: "2026-06-22T00:00:00.000Z" });
    expect(toReparentPayload({ ...base, parentId: "p1" }, "2026-06-22T00:00:00.000Z")).toEqual({ newParentId: "p1", updatedAt: "2026-06-22T00:00:00.000Z" });
  });
});

describe("toDeletePayload(P9 — 확인 자식 집합)", () => {
  it("화면에 보인 직속 자식 ID + updatedAt 동반(leaf는 빈 배열)", () => {
    expect(toDeletePayload({ updatedAt: "2026-06-22T00:00:00.000Z", children: [{ id: "c1" }, { id: "c2" }] }))
      .toEqual({ updatedAt: "2026-06-22T00:00:00.000Z", confirmedChildIds: ["c1", "c2"] });
    expect(toDeletePayload({ updatedAt: "2026-06-22T00:00:00.000Z", children: [] }))
      .toEqual({ updatedAt: "2026-06-22T00:00:00.000Z", confirmedChildIds: [] });
  });
});

describe("hrefWarning(소프트 경고 — D7)", () => {
  it("빈 href·알려진 경로는 경고 없음, 미지 경로는 경고", () => {
    expect(hrefWarning("")).toBeNull();
    expect(hrefWarning("/admin/navigation")).toBeNull();
    expect(hrefWarning("/unknown")).toMatch(/내부 경로/);
  });
});

describe("deleteConfirmLabel(D11)", () => {
  it("자식 수에 따라 cascade 문구", () => {
    expect(deleteConfirmLabel({ label: "관리", children: [{}, {}] as never[] })).toMatch(/하위 메뉴 2개/);
    expect(deleteConfirmLabel({ label: "대시보드", children: [] })).not.toMatch(/하위/);
  });
});

// P10 회귀 테스트 — out-of-order 응답 가드
// RolePreview 효과의 핵심 판단 로직을 순수 헬퍼(isLatestRequest)로 추출해 DOM/fetch 없이 검증.
// 시나리오: A 선택 후 빠르게 B 선택. A 응답이 B 응답보다 늦게 도착.
// isLatestRequest(token, currentToken): token이 currentToken이어야 apply — stale(A)은 버린다.
describe("isLatestRequest — P10 out-of-order 가드", () => {
  it("동일 토큰이면 true(최신 요청)", () => {
    expect(isLatestRequest(2, 2)).toBe(true);
  });
  it("낡은 토큰이면 false(stale 응답 무시)", () => {
    expect(isLatestRequest(1, 2)).toBe(false);
  });
  it("A→B 전환 시나리오: A(token=1) 응답이 B(token=2) 이후 도착해도 apply 안 됨", () => {
    // currentToken이 2인 상황에서 A(token=1) 응답이 도착
    const currentToken = 2;
    const aToken = 1;
    const bToken = 2;
    // A 응답 → stale, B 응답 → apply
    expect(isLatestRequest(aToken, currentToken)).toBe(false); // A 무시
    expect(isLatestRequest(bToken, currentToken)).toBe(true);  // B 적용
  });
});
