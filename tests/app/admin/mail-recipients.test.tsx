// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn());
const toastErr = vi.hoisted(() => vi.fn());
const toastOk = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  contacts: { data: undefined as unknown, isLoading: false, isError: false },
  sets: { data: undefined as unknown, isLoading: false, isError: false },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => (opts.queryKey[0] === "mail-contacts" ? state.contacts : state.sets),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock("sonner", () => ({ toast: { error: toastErr, success: toastOk } }));

import { MailRecipients } from "@/app/(app)/admin/settings/mail-recipients/mail-recipients";

const CONTACTS = { contacts: [{ id: "c1", email: "hong@x.com", name: "홍길동", memo: "고객사 A 회계" }] };
const SETS = {
  sets: [{
    kind: "BILLING", steps: ["1", "2"],
    recipients: {
      "1": { to: ["hong@x.com"], cc: ["etc@x.com"], bcc: [] },
      "2": { to: [], cc: [], bcc: [] },
    },
  }],
};

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); invalidate.mockClear(); toastErr.mockClear(); toastOk.mockClear();
  state.contacts = { data: CONTACTS, isLoading: false, isError: false };
  state.sets = { data: SETS, isLoading: false, isError: false };
});

function setup() {
  state.contacts = { data: CONTACTS, isLoading: false, isError: false };
  state.sets = { data: SETS, isLoading: false, isError: false };
  render(<MailRecipients />);
}

describe("렌더", () => {
  it("주소록 테이블 + 세트 카드(kind 라벨·단계) + 이름 배지·미등록 배지(D12)", () => {
    setup();
    expect(screen.getAllByText("hong@x.com").length).toBeGreaterThan(0); // 테이블 + 칩
    expect(screen.getByText("대금청구")).toBeTruthy();           // KIND_LABEL
    expect(screen.getByText("1단계")).toBeTruthy();
    expect(screen.getByText("2단계")).toBeTruthy();
    expect(screen.getAllByText("홍길동").length).toBeGreaterThan(0); // 테이블 + 칩 배지
    expect(screen.getByText("주소록 미등록")).toBeTruthy();      // etc@x.com
  });
  it("로드 오류 → ErrorState", () => {
    state.contacts = { data: undefined, isLoading: false, isError: true };
    state.sets = { data: SETS, isLoading: false, isError: false };
    render(<MailRecipients />);
    expect(screen.getByText(/불러오지 못했습니다/)).toBeTruthy();
  });
});

describe("주소록 CRUD", () => {
  it("추가: POST payload(email·name·memo)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.change(screen.getByLabelText("추가 이메일"), { target: { value: "new@x.com" } });
    fireEvent.change(screen.getByLabelText("추가 이름"), { target: { value: "김철수" } });
    fireEvent.change(screen.getByLabelText("추가 메모"), { target: { value: "메모" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/mail/contacts");
    expect(JSON.parse(init.body as string)).toEqual({ email: "new@x.com", name: "김철수", memo: "메모" });
  });
  it("추가: 409 → 중복 안내 토스트", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.change(screen.getByLabelText("추가 이메일"), { target: { value: "hong@x.com" } });
    fireEvent.change(screen.getByLabelText("추가 이름"), { target: { value: "홍" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("이미 등록된 이메일입니다."));
  });
  it("수정 모달: email은 표시 전용, PATCH body에 name·memo만(D15)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.queryByLabelText("이메일")).toBeNull(); // 입력 필드 아님
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동2" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/mail/contacts/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "홍길동2", memo: "고객사 A 회계" });
  });
  it("삭제: 2-click confirm 후 DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(fetchMock).not.toHaveBeenCalled(); // 1클릭째는 확인 대기
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows/mail/contacts/c1", expect.objectContaining({ method: "DELETE" })));
  });
});

describe("세트 저장", () => {
  it("PUT: 전체 맵 payload(자기 kind 전 step 포함)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.change(screen.getByLabelText("1단계 참조"), { target: { value: "etc@x.com, new@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "대금청구 세트 저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/mail/recipients/BILLING");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      "1": { to: ["hong@x.com"], cc: ["etc@x.com", "new@x.com"], bcc: [] },
      "2": { to: [], cc: [], bcc: [] },
    });
  });
  it("PUT 400 → 형식 안내 토스트", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "대금청구 세트 저장" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("이메일 형식을 확인하세요."));
  });
});
