import { describe, it, expect } from "vitest";
import { computeNavRows, isActiveHref } from "@/app/(app)/app-nav";

type NavItem = { key: string; label: string; href: string | null; children: NavItem[] };
const leaf = (key: string, href: string | null): NavItem => ({ key, label: key, href, children: [] });

describe("isActiveHref", () => {
  it("정확 일치·하위 경로는 active, null·무관 경로는 아님", () => {
    expect(isActiveHref("/admin", "/admin")).toBe(true);
    expect(isActiveHref("/admin", "/admin/navigation")).toBe(true);
    expect(isActiveHref("/admin", "/dashboard")).toBe(false);
    expect(isActiveHref(null, "/admin")).toBe(false);
    expect(isActiveHref("/admin", "/administrators")).toBe(false); // prefix 오탐 방지(슬래시 경계)
  });
});

describe("computeNavRows (active·targetHref)", () => {
  const items: NavItem[] = [
    leaf("dashboard", "/dashboard"),
    // 부모 href(/admin)는 placeholder, 첫 자식은 /admin/users.
    { key: "admin", label: "관리", href: "/admin", children: [leaf("admin-users", "/admin/users"), leaf("admin-teams", "/admin/teams")] },
    { key: "leave", label: "연차", href: "/leave", children: [leaf("leave-dashboard", "/leave"), leaf("leave-request", "/leave/request")] },
  ];

  it("자식 있는 부모의 targetHref는 첫 자식 href(부모 클릭 시 첫 중메뉴로 이동)", () => {
    const rows = computeNavRows(items, "/dashboard");
    expect(rows.find((r) => r.key === "admin")!.targetHref).toBe("/admin/users");
    expect(rows.find((r) => r.key === "leave")!.targetHref).toBe("/leave");
  });

  it("자식 없는 leaf의 targetHref는 자기 href", () => {
    const rows = computeNavRows(items, "/dashboard");
    expect(rows.find((r) => r.key === "dashboard")!.targetHref).toBe("/dashboard");
  });

  it("현재 경로가 자식이면 부모 active + 자식 active 표시", () => {
    const rows = computeNavRows(items, "/admin/users");
    const admin = rows.find((r) => r.key === "admin")!;
    expect(admin.active).toBe(true);
    expect(admin.children.find((c) => c.key === "admin-users")!.active).toBe(true);
  });

  it("무관 경로면 부모 비활성", () => {
    const rows = computeNavRows(items, "/dashboard");
    expect(rows.find((r) => r.key === "admin")!.active).toBe(false);
  });
});

describe("computeNavRows — 형제 최장 매칭 우선(D8)", () => {
  const leave: NavItem = {
    key: "leave", label: "연차", href: "/leave",
    children: [
      leaf("leave-dashboard", "/leave"),
      leaf("leave-request", "/leave/request"),
      leaf("leave-calendar", "/leave/calendar"),
      leaf("leave-history", "/leave/history"),
      leaf("leave-manage", "/leave/manage"),
    ],
  };
  const items: NavItem[] = [leaf("dashboard", "/dashboard"), leave];

  const childActiveKeys = (pathname: string) =>
    computeNavRows(items, pathname)
      .find((r) => r.key === "leave")!
      .children.filter((c) => c.active)
      .map((c) => c.key);

  it("/leave → 대시보드(인덱스)만 active", () => {
    expect(childActiveKeys("/leave")).toEqual(["leave-dashboard"]);
  });

  it("/leave/request → 연차 신청만 active(대시보드 아님)", () => {
    expect(childActiveKeys("/leave/request")).toEqual(["leave-request"]);
  });

  it("/leave/manage/allocations → 연차 관리만 active(prefix 최장)", () => {
    expect(childActiveKeys("/leave/manage/allocations")).toEqual(["leave-manage"]);
  });

  it("부모 연차는 모든 /leave/* 에서 active", () => {
    for (const p of ["/leave", "/leave/request", "/leave/manage/status"]) {
      const row = computeNavRows(items, p).find((r) => r.key === "leave")!;
      expect(row.active, p).toBe(true);
    }
  });

  it("연차 외 경로(/dashboard)면 자식 active 없음", () => {
    expect(childActiveKeys("/dashboard")).toEqual([]);
  });
});
