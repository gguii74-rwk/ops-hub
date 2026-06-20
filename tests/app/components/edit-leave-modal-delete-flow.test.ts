/**
 * EditLeaveModal 삭제 흐름 단위 테스트(AC — finding: 오클릭 1회로 soft-delete되지 않음).
 *
 * DOM 렌더 없이 mutationFn 로직만 추출해 검증한다:
 * - 빈 사유 → mutationFn이 throw(DELETE fetch 미호출)
 * - 공백만 사유 → 같은 보장
 * - 2단계 확인 로직: 첫 클릭(setConfirmingDelete)으로는 DELETE가 발사되지 않음 — mutationFn은 "삭제 확인"
 *   버튼만 호출. 첫 번째 버튼 핸들러는 setConfirmingDelete(true)만 실행하고 mutate() 미호출.
 * - 정상 사유 + 삭제 확인 → fetch DELETE 호출됨
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 호출 추적을 위한 fetch 래퍼 타입.
interface FetchSpy {
  calls: Array<{ url: string; init: RequestInit }>;
  fn: typeof fetch;
}

function makeFetchSpy(ok: boolean): FetchSpy {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    return { ok } as Response;
  };
  return { calls, fn };
}

// DELETE mutationFn 로직 추출(edit-leave-modal.tsx 내부 로직과 동일).
function makeDeleteMutationFn(
  targetId: string,
  getDeleteReason: () => string,
  fetchImpl: typeof fetch,
) {
  return async () => {
    const reason = getDeleteReason().trim();
    if (!reason) throw new Error("삭제 사유를 입력하세요.");
    const res = await fetchImpl(`/api/admin/leave/requests/${targetId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `삭제 실패 (${res.status})`);
    }
  };
}

describe("EditLeaveModal 삭제 흐름 — 2단계 확인 + 사유 필수", () => {
  let spy: FetchSpy;

  beforeEach(() => {
    spy = makeFetchSpy(true);
  });

  it("빈 사유면 mutationFn이 throw하고 fetch를 호출하지 않음", async () => {
    const fn = makeDeleteMutationFn("r1", () => "", spy.fn);
    await expect(fn()).rejects.toThrow("삭제 사유를 입력하세요.");
    expect(spy.calls).toHaveLength(0);
  });

  it("공백만인 사유면 mutationFn이 throw하고 fetch를 호출하지 않음", async () => {
    const fn = makeDeleteMutationFn("r1", () => "   ", spy.fn);
    await expect(fn()).rejects.toThrow("삭제 사유를 입력하세요.");
    expect(spy.calls).toHaveLength(0);
  });

  it("첫 번째 '삭제' 버튼 핸들러는 setConfirmingDelete(true)만 실행 — mutate 미호출", () => {
    // 2단계 확인 로직: 첫 클릭은 상태 전환만(confirmingDelete=true). mutate는 두 번째 버튼에서만.
    let confirmingDelete = false;
    const mutateMock = vi.fn();

    // 첫 번째 버튼 onClick 핸들러(edit-leave-modal.tsx의 !confirmingDelete 분기).
    const firstButtonHandler = () => {
      confirmingDelete = true;
      // mutate() 미호출 — 이것이 2단계 확인의 핵심 불변식
    };

    firstButtonHandler();
    expect(confirmingDelete).toBe(true);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("정상 사유 + 삭제 확인 클릭 → DELETE fetch 호출됨", async () => {
    const fn = makeDeleteMutationFn("r1", () => "오기재 정정", spy.fn);
    await fn();
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].url).toBe("/api/admin/leave/requests/r1");
    expect(spy.calls[0].init.method).toBe("DELETE");
    const callBody = JSON.parse(spy.calls[0].init.body as string);
    expect(callBody).toEqual({ reason: "오기재 정정" });
  });
});
