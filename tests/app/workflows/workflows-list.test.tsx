// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const can = vi.hoisted(() => ({ create: false }));
vi.mock("@/lib/auth/permissions-client", () => ({
  useCan: (resource: string, action: string) => resource === "workflows.billing" && action === "create" && can.create,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false, isError: false }),
}));

import { WorkflowsList } from "@/app/(app)/workflows/workflows-list";

afterEach(() => { cleanup(); can.create = false; });

describe("WorkflowsList 생성 버튼 게이트", () => {
  it("billing:create 없으면 '새 대금청구 작업' 미노출", () => {
    can.create = false;
    render(<WorkflowsList />);
    expect(screen.queryByRole("button", { name: "새 대금청구 작업" })).toBeNull();
  });
  it("billing:create 있으면 노출", () => {
    can.create = true;
    render(<WorkflowsList />);
    expect(screen.getByRole("button", { name: "새 대금청구 작업" })).not.toBeNull();
  });
});
