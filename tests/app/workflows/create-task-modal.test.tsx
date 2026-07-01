// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
const toastErr = vi.hoisted(() => vi.fn());
// kind별 create 권한 토글(resource="workflows.<x>", action="create").
const can = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: toastErr, success: vi.fn() } }));
vi.mock("@/lib/auth/permissions-client", () => ({
  useCan: (resource: string, action: string) => can.keys.has(`${resource}:${action}`),
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: { mutationFn: () => Promise<unknown>; onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => ({
    mutate: async () => { try { opts.onSuccess?.(await opts.mutationFn()); } catch (e) { opts.onError?.(e); } },
    isPending: false, isError: false, error: null,
  }),
}));

import { CreateTaskModal } from "@/app/(app)/workflows/create-task-modal";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockClear(); toastErr.mockClear(); can.keys = new Set(); });
const dialog = () => screen.getByRole("dialog");

describe("CreateTaskModal — 유형 드롭다운 권한 게이트(수준 B)", () => {
  it("create 권한 있는 유형만 옵션에 노출(billing+weeklyClient만)", () => {
    can.keys = new Set(["workflows.billing:create", "workflows.weeklyClient:create"]);
    render(<CreateTaskModal onClose={() => {}} />);
    const select = within(dialog()).getByLabelText("유형") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["대금청구", "주간보고(고객사)"]); // WORKFLOW_KIND_ORDER 순서
  });

  it("유형 1개면 그 값으로 고정(옵션 1개)", () => {
    can.keys = new Set(["workflows.notification:create"]);
    render(<CreateTaskModal onClose={() => {}} />);
    const select = within(dialog()).getByLabelText("유형") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.value).toBe("NOTIFICATION_BILLING");
  });

  it("옵션 0개면 안내 + 생성 비활성", () => {
    can.keys = new Set();
    render(<CreateTaskModal onClose={() => {}} />);
    expect(within(dialog()).queryByLabelText("유형")).toBeNull();
    const btn = within(dialog()).getByRole("button", { name: "생성" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe("CreateTaskModal — prefill·제출", () => {
  it("defaultDate가 예정일에 prefill", () => {
    can.keys = new Set(["workflows.billing:create"]);
    render(<CreateTaskModal defaultDate="2026-07-15" onClose={() => {}} />);
    const date = within(dialog()).getByLabelText("예정일") as HTMLInputElement;
    expect(date.value).toBe("2026-07-15");
  });

  it("생성 클릭 → POST {kind, scheduledAt} → 상세 이동·onClose", async () => {
    can.keys = new Set(["workflows.monthlyClient:create"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "t9" }) });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<CreateTaskModal defaultDate="2026-07-20" onClose={onClose} />);
    fireEvent.click(within(dialog()).getByRole("button", { name: "생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "MONTHLY_REPORT_CLIENT", scheduledAt: "2026-07-20" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workflows/t9"));
    expect(onClose).toHaveBeenCalled();
  });

  it("유형 변경 후 제출 시 선택된 kind로 POST", async () => {
    can.keys = new Set(["workflows.billing:create", "workflows.weekly:create"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "t1" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateTaskModal defaultDate="2026-07-10" onClose={() => {}} />);
    fireEvent.change(within(dialog()).getByLabelText("유형"), { target: { value: "WEEKLY_REPORT" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ kind: "WEEKLY_REPORT", scheduledAt: "2026-07-10" });
  });

  it("403 → 권한 토스트, 이동 없음", async () => {
    can.keys = new Set(["workflows.billing:create"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateTaskModal defaultDate="2026-07-10" onClose={() => {}} />);
    fireEvent.click(within(dialog()).getByRole("button", { name: "생성" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("예정일 미입력 시 생성 비활성", () => {
    can.keys = new Set(["workflows.billing:create"]);
    render(<CreateTaskModal onClose={() => {}} />);
    const btn = within(dialog()).getByRole("button", { name: "생성" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
