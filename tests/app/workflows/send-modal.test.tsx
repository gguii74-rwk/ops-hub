// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn());
const toastErr = vi.hoisted(() => vi.fn());
const toastOk = vi.hoisted(() => vi.fn());
// config GET 상태를 케이스별로 토글(F-A2: 404 공백 / 일시오류 차단).
const cfgState = vi.hoisted(() => ({ data: { projectName: "테스트사업" } as { projectName: string } | undefined, isLoading: false, isError: false }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => cfgState,
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock("sonner", () => ({ toast: { error: toastErr, success: toastOk } }));

import { SendModal } from "@/app/(app)/workflows/[id]/send-modal";

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); invalidate.mockClear(); toastErr.mockClear(); toastOk.mockClear();
  cfgState.data = { projectName: "테스트사업" }; cfgState.isLoading = false; cfgState.isError = false;
});

// 2026-02-09T15:00Z = KST 2026-02-10 → 전월=1월, projectYear=2026
const SCHEDULED = "2026-02-09T15:00:00.000Z";

describe("SendModal prefill", () => {
  it("effectiveRecipients·템플릿(projectName·전월) prefill", () => {
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com", "b@x.com"]} onClose={() => {}} />);
    expect((screen.getByLabelText("수신자") as HTMLInputElement).value).toBe("a@x.com, b@x.com");
    const subject = (screen.getByLabelText("제목") as HTMLInputElement).value;
    expect(subject).toContain("테스트사업");
    expect(subject).toContain("1월");
  });
  it("step2는 '첨부 없음' 안내", () => {
    render(<SendModal taskId="t1" step={2} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com"]} onClose={() => {}} />);
    expect(screen.getByText(/첨부 없음/)).toBeTruthy();
  });
});

describe("SendModal fail-closed (D6)", () => {
  it("① 빈 To는 발송 차단(fetch 미발생) + 검증 오류", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/수신자를 1명 이상/)).toBeTruthy();
  });

  it("② 제출 시 recipients가 화면 목록과 정확히 일치(생략 없음)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={[]} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("수신자"), { target: { value: "a@x.com,  b@x.com " } });
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/t1/send");
    const payload = JSON.parse(init.body as string);
    expect(payload.step).toBe(1);
    expect(payload.recipients).toEqual(["a@x.com", "b@x.com"]); // trim·filter 후 정확히, 생략 없음
    expect(typeof payload.subject).toBe("string");
    expect(payload.body).toContain("<p>"); // plainToHtml 적용
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("409 → 상태 충돌 토스트, onClose 안 함", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com"]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SendModal config 로드 (F-A2)", () => {
  it("일시 오류(404 아님) → 발송 폼 미렌더(fail-closed) + 발송 버튼 없음", () => {
    cfgState.isError = true; cfgState.data = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com"]} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "발송" })).toBeNull();
    expect(screen.getByText(/설정을 불러오지 못했습니다/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("404(설정 없음, 사업명 공백) → 경고 노출하되 발송 가능(D5 편집 경로 보존)", () => {
    cfgState.isError = false; cfgState.data = { projectName: "" };
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com"]} onClose={() => {}} />);
    expect(screen.getByText(/설정\(사업명\)이 없습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "발송" })).toBeTruthy();
  });
});

describe("SendModal F-A1 escape-chain (end-to-end)", () => {
  it("projectName에 HTML 특수문자가 있어도 POST body는 escape된 형태", async () => {
    // cfgState.data에 HTML-special characters 포함 사업명 설정
    cfgState.data = { projectName: "A&B <b>회사</b>" };
    cfgState.isError = false; cfgState.isLoading = false;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com"]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body as string);
    // F-A1: plainToHtml이 적용되어 body에 raw <b>회사</b>가 없어야 함
    expect(payload.body).not.toContain("<b>회사</b>");
    // escape된 형태가 포함되어야 함
    expect(payload.body).toContain("&lt;b&gt;");
    expect(payload.body).toContain("&amp;");
    // buildBody가 projectName을 포함하므로 escape된 사업명이 body에 있어야 함
    expect(payload.body).toContain("A&amp;B");
  });
});

describe("SendModal stale config prefill (refetch resync)", () => {
  it("config refetch로 projectName이 바뀌면 제목·본문이 최신 사업명으로 재prefill", () => {
    // React Query가 캐시된(이전/404) 설정을 즉시 반환한 뒤 최신 설정으로 갱신되는 상황을 모사.
    cfgState.data = { projectName: "이전사업" };
    const { rerender } = render(
      <SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com"]} onClose={() => {}} />,
    );
    expect((screen.getByLabelText("제목") as HTMLInputElement).value).toContain("이전사업");
    cfgState.data = { projectName: "최신사업" };
    rerender(
      <SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={["a@x.com"]} onClose={() => {}} />,
    );
    const subject = (screen.getByLabelText("제목") as HTMLInputElement).value;
    expect(subject).toContain("최신사업");
    expect(subject).not.toContain("이전사업");
  });
});
