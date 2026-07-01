// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 캘린더/목록 하위 뷰는 스텁 — 토글 동작만 격리 검증.
vi.mock("@/app/(app)/workflows/workflows-calendar", () => ({ WorkflowsCalendar: () => <div data-testid="calendar-view" /> }));
vi.mock("@/app/(app)/workflows/workflows-list", () => ({ WorkflowsList: () => <div data-testid="list-view" /> }));

import { WorkflowsView } from "@/app/(app)/workflows/workflows-view";

afterEach(cleanup);

describe("WorkflowsView 캘린더/목록 토글", () => {
  it("기본은 캘린더", () => {
    render(<WorkflowsView />);
    expect(screen.getByTestId("calendar-view")).toBeTruthy();
    expect(screen.queryByTestId("list-view")).toBeNull();
  });

  it("'목록' 클릭 시 목록으로 전환", () => {
    render(<WorkflowsView />);
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    expect(screen.getByTestId("list-view")).toBeTruthy();
    expect(screen.queryByTestId("calendar-view")).toBeNull();
  });

  it("'캘린더' 클릭 시 다시 캘린더로", () => {
    render(<WorkflowsView />);
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    fireEvent.click(screen.getByRole("button", { name: "캘린더" }));
    expect(screen.getByTestId("calendar-view")).toBeTruthy();
    expect(screen.queryByTestId("list-view")).toBeNull();
  });
});
