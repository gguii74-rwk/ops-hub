// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// 모호한 쓰기 결과 시 권위 상태 재조회용 router.refresh 모킹.
const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { SettingEditor } from "@/app/(app)/admin/settings/settings-editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  routerRefresh.mockClear();
});

describe("SettingEditor — boolean 분기", () => {
  it("boolean initialValue → Switch 렌더(textarea 아님)", () => {
    render(<SettingEditor settingKey="leave.notifications.onRequest" initialValue={true} updatedAt={null} />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Switch 클릭 → PUT(value:false·expectedUpdatedAt 토큰)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "2026-06-25T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SettingEditor
        settingKey="leave.notifications.onApprove"
        initialValue={true}
        updatedAt="2026-06-24T00:00:00.000Z"
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/settings/leave.notifications.onApprove");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.value).toBe(false);
    expect(body.expectedUpdatedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("PUT 409(행 변경됨=stale) → 롤백 대신 router.refresh로 권위 재조회", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onReject" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch") as HTMLButtonElement;
    fireEvent.click(sw);
    // 409=다른 사용자가 행 변경 → prev도 stale이므로 롤백 금지, refetch로 진짜 상태 재조회.
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    expect(sw.disabled).toBe(false);
  });

  it("PUT 422(값 거부·행 불변=rejected) → prev로 롤백 + router.refresh 미호출", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onReject" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    // 422=값 거부, 행 불변 → prev가 권위값 → 안전 롤백, refresh 불필요.
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("PUT fetch 거부(응답 수신 실패=refetch) → 롤백 대신 router.refresh로 권위 상태 재조회 + 재활성화", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onApprove" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch") as HTMLButtonElement;
    fireEvent.click(sw);
    // 응답 수신 실패 → 반영 여부 불명 → 단정(롤백) 금지, refresh로 진짜 상태 재조회.
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    expect(sw.disabled).toBe(false); // saving 해제(재활성화)
  });

});

describe("SettingEditor — 타입 분기(D8)", () => {
  it("string initialValue → text input(textarea/switch 아님)", () => {
    render(<SettingEditor settingKey="integrations.smtp.fromAddress" initialValue={"ops@x.com"} updatedAt={null} />);
    expect(document.querySelector("input")).toBeTruthy();
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("number initialValue → number input(spinbutton, 초기값 표시)", () => {
    render(<SettingEditor settingKey="demo.number.value" initialValue={587} updatedAt={null} />);
    const spin = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(spin.value).toBe("587");
  });

  it("object initialValue → 기존 JSON textarea 폴백", () => {
    render(<SettingEditor settingKey="workflows.billing.config" initialValue={{ year: 2026 }} updatedAt={null} />);
    expect(document.querySelector("textarea")).toBeTruthy();
  });

  it("string 편집기 저장 → PUT(value:string·token), ok 시 토큰 갱신", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "2026-06-26T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="integrations.smtp.fromAddress" initialValue={"ops@x.com"} updatedAt="2026-06-25T00:00:00.000Z" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/settings/integrations.smtp.fromAddress");
    const body = JSON.parse(init.body as string);
    expect(body.value).toBe("new@x.com");
    expect(body.expectedUpdatedAt).toBe("2026-06-25T00:00:00.000Z");
  });

  it("number 편집기 저장 → PUT(value:number, 문자열 아님)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "2026-06-26T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="demo.number.value" initialValue={587} updatedAt={null} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "465" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).value).toBe(465);
  });

  it("list 편집기: 행 추가 후 저장 → PUT(value: 전체 배열)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="integrations.google.calendarIds" initialValue={["cal-1"]} updatedAt={null} />);
    fireEvent.change(screen.getByPlaceholderText("추가할 항목 입력"), { target: { value: "cal-2" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).value).toEqual(["cal-1", "cal-2"]);
  });

  it("list 편집기: 삭제(✕) 후 저장 → 해당 항목 빠진 배열", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="integrations.google.calendarIds" initialValue={["cal-1", "cal-2"]} updatedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "cal-1 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).value).toEqual(["cal-2"]);
  });
});
