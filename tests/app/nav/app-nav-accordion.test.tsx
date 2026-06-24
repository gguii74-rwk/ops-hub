// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// usePathname을 mutable holder로 mock — rerender 사이에 경로를 바꿔 클라이언트 라우팅을 흉내낸다.
const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { AppNav } from "@/app/(app)/app-nav";

type NavItem = { key: string; label: string; href: string | null; children: NavItem[] };
const items: NavItem[] = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", children: [] },
  {
    key: "leave", label: "연차", href: "/leave", children: [
      { key: "leave-dashboard", label: "연차 대시보드", href: "/leave", children: [] },
      { key: "leave-request", label: "연차 신청", href: "/leave/request", children: [] },
    ],
  },
  {
    key: "admin", label: "관리", href: "/admin", children: [
      { key: "admin-users", label: "사용자 관리", href: "/admin/users", children: [] },
      { key: "admin-teams", label: "팀 관리", href: "/admin/teams", children: [] },
    ],
  },
];

afterEach(() => cleanup());

describe("AppNav 아코디언", () => {
  it("현재 경로 섹션만 펼침: /admin/users면 관리 자식 보이고 연차 자식 안 보임", () => {
    nav.pathname = "/admin/users";
    render(<AppNav items={items} />);
    expect(screen.queryByText("사용자 관리")).not.toBeNull();
    expect(screen.queryByText("연차 신청")).toBeNull();
  });

  it("다른 섹션으로 이동하면 이전 섹션 트리가 닫힌다(이슈2 회귀 방지)", () => {
    nav.pathname = "/admin/users";
    const { rerender } = render(<AppNav items={items} />);
    expect(screen.queryByText("사용자 관리")).not.toBeNull();

    // 클라이언트 라우팅으로 다른 섹션 진입
    nav.pathname = "/leave/request";
    rerender(<AppNav items={items} />);
    expect(screen.queryByText("연차 신청")).not.toBeNull(); // 새 섹션 열림
    expect(screen.queryByText("사용자 관리")).toBeNull();    // 이전 섹션 닫힘 ← 버그였던 지점
  });

  it("수동 토글은 단일 확장: 한 섹션 펼치면 다른 섹션 닫힘", () => {
    nav.pathname = "/dashboard";
    render(<AppNav items={items} />);
    expect(screen.queryByText("사용자 관리")).toBeNull();
    expect(screen.queryByText("연차 신청")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /관리 하위 메뉴/ }));
    expect(screen.queryByText("사용자 관리")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /연차 하위 메뉴/ }));
    expect(screen.queryByText("연차 신청")).not.toBeNull();
    expect(screen.queryByText("사용자 관리")).toBeNull(); // 단일 확장 — 이전 수동 펼침 닫힘
  });

  it("현재 위치 섹션은 화살표로 접히지 않는다(현재 위치 보호)", () => {
    nav.pathname = "/admin/users";
    render(<AppNav items={items} />);
    expect(screen.queryByText("사용자 관리")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /관리 하위 메뉴/ }));
    expect(screen.queryByText("사용자 관리")).not.toBeNull(); // 토글해도 현재 섹션은 유지
  });

  it("현재 위치 유지하며 다른 섹션을 미리 펼칠 수 있다(최대 2개)", () => {
    nav.pathname = "/admin/users";
    render(<AppNav items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /연차 하위 메뉴/ }));
    expect(screen.queryByText("연차 신청")).not.toBeNull();   // 미리보기 펼침
    expect(screen.queryByText("사용자 관리")).not.toBeNull(); // 현재 위치 유지
  });

  it("부모 헤더 링크가 첫 자식을 가리킨다(이슈1)", () => {
    nav.pathname = "/dashboard";
    render(<AppNav items={items} />);
    expect(screen.getByRole("link", { name: "관리" }).getAttribute("href")).toBe("/admin/users");
  });

  it("href=null 부모는 링크가 아니라 그룹 헤더 — 화살표로만 펼친다(D5 계약)", () => {
    nav.pathname = "/dashboard";
    const grouped: NavItem[] = [
      { key: "admin", label: "관리", href: null, children: [
        { key: "admin-users", label: "사용자 관리", href: "/admin/users", children: [] },
      ] },
    ];
    render(<AppNav items={grouped} />);
    expect(screen.queryByRole("link", { name: "관리" })).toBeNull(); // 부모는 비링크
    fireEvent.click(screen.getByRole("button", { name: /관리 하위 메뉴/ }));
    expect(screen.queryByText("사용자 관리")).not.toBeNull(); // 화살표로는 펼침 가능
  });
});
