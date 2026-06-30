// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
const toastErr = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: toastErr, success: vi.fn() } }));
// mutate가 mutationFn 실행 후 onSuccess/onError를 호출하도록(라우팅·토스트 검증).
vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: { mutationFn: () => Promise<unknown>; onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => ({
    mutate: async () => { try { opts.onSuccess?.(await opts.mutationFn()); } catch (e) { opts.onError?.(e); } },
    isPending: false, isError: false, error: null,
  }),
}));

import { CreateTaskModal } from "@/app/(app)/workflows/create-task-modal";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockClear(); toastErr.mockClear(); });

const dialog = () => screen.getByRole("dialog");

describe("CreateTaskModal", () => {
  it("예정일 미입력 시 생성 버튼 비활성", () => {
    render(<CreateTaskModal onClose={() => {}} />);
    const btn = within(dialog()).getByRole("button", { name: "생성" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("생성 클릭 → POST {kind:BILLING, scheduledAt} → 상세로 이동·onClose", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "t9" }) });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<CreateTaskModal onClose={onClose} />);
    fireEvent.change(within(dialog()).getByLabelText("예정일"), { target: { value: "2026-06-30" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "BILLING", scheduledAt: "2026-06-30" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workflows/t9"));
    expect(onClose).toHaveBeenCalled();
  });

  it("403 → 권한 토스트, 이동 없음", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateTaskModal onClose={() => {}} />);
    fireEvent.change(within(dialog()).getByLabelText("예정일"), { target: { value: "2026-06-30" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "생성" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});
