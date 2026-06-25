// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 이 저장소 규약: react-query는 모듈 통째 모킹. mutate는 mutationFn을 즉시 호출해 fetch 검증.
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useMutation: (opts: { mutationFn: () => unknown }) => ({
    mutate: () => opts.mutationFn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { RequestLeaveModal } from "@/app/(app)/leave/_components/request-leave-modal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  invalidate.mockClear();
});

function dateInputs() {
  const dialog = screen.getByRole("dialog");
  return Array.from(dialog.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
}

describe("RequestLeaveModal", () => {
  it("defaultDate를 시작일·종료일 모두에 채운다", () => {
    render(<RequestLeaveModal defaultDate="2026-06-15" onClose={() => {}} />);
    const inputs = dateInputs();
    expect(inputs).toHaveLength(2); // ANNUAL 기본: 시작일+종료일
    expect(inputs[0].value).toBe("2026-06-15");
    expect(inputs[1].value).toBe("2026-06-15");
  });

  it("신청 클릭 시 /api/leave/requests로 POST(payload=시작=종료)", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RequestLeaveModal defaultDate="2026-06-15" onClose={() => {}} />);
    fireEvent.click(within(screen.getByRole("dialog")).getByText("신청"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/leave/requests");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.startDate).toBe("2026-06-15");
    expect(body.endDate).toBe("2026-06-15");
    expect(body.leaveType).toBe("ANNUAL");
  });
});
