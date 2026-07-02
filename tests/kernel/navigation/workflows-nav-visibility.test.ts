import { describe, it, expect } from "vitest";
import { selectVisibleNav, type RawNavParent } from "@/kernel/navigation";

// 배포 후 DB nav를 모사한 workflows 트리(부모=집계 workflows:view, index 자식=캘린더/집계, 설정 자식=billing:configure).
const parent = (): RawNavParent => ({
  key: "workflows", label: "업무", href: "/workflows", sortOrder: 30,
  requiredPermission: { resource: "workflows", action: "view" },
  children: [
    { key: "workflows-list", label: "캘린더", href: "/workflows", sortOrder: 10, requiredPermission: { resource: "workflows", action: "view" } },
    { key: "workflows-billing-settings", label: "대금청구 설정", href: "/workflows/billing/settings", sortOrder: 20, requiredPermission: { resource: "workflows.billing", action: "configure" } },
  ],
});

describe("selectVisibleNav — workflows 집계 게이팅(D13)", () => {
  it("workflows:view 보유 → 부모+캘린더 자식 노출(href 유지)", () => {
    const out = selectVisibleNav([parent()], new Set(["workflows:view"]));
    const wf = out.find((n) => n.key === "workflows");
    expect(wf).toBeTruthy();
    expect(wf!.href).toBe("/workflows");
    expect(wf!.children.map((c) => c.key)).toContain("workflows-list");
  });

  it("workflows.notification:view만(집계 없음) → 메뉴 숨김(D13 핵심 — kind view만으론 노출 안 됨)", () => {
    const out = selectVisibleNav([parent()], new Set(["workflows.notification:view"]));
    expect(out.find((n) => n.key === "workflows")).toBeUndefined();
  });

  it("권한 없음 → 숨김", () => {
    expect(selectVisibleNav([parent()], new Set()).find((n) => n.key === "workflows")).toBeUndefined();
  });

  it("billing:configure만 → 부모 관용 노출(설정 자식만), href=null(자체 권한 없음, D5)", () => {
    const out = selectVisibleNav([parent()], new Set(["workflows.billing:configure"]));
    const wf = out.find((n) => n.key === "workflows");
    expect(wf).toBeTruthy();
    expect(wf!.href).toBeNull();
    expect(wf!.children.map((c) => c.key)).toEqual(["workflows-billing-settings"]);
  });
});
