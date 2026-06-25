# Task 01 — RequestLeaveModal 신설 + CreateLeaveModal 종료일 기본값

자가신청 전용 모달 컴포넌트를 신설하고, 관리자 직접입력 모달의 종료일 기본값을 추가한다.

## Files

- Create: `src/app/(app)/leave/_components/request-leave-modal.tsx`
- Create: `tests/app/leave/request-leave-modal.test.tsx`
- Modify: `src/app/(app)/leave/_components/create-leave-modal.tsx` (초기 state에 `endDate` 추가)

## Prep

- 스펙 §설계 "신규: RequestLeaveModal", §설계 "수정: CreateLeaveModal" 읽기.
- 엔트리포인트 §Shared Contracts의 `LeaveFormState`/`emptyLeaveForm`/`LeaveFields`/`toLeavePayload`, 테스트 규약(react-query 통째 모킹) 사용.
- 참고 원본(본뜰 대상): `src/app/(app)/leave/_components/create-leave-modal.tsx`.

## Deps

없음.

## Step 1 — RequestLeaveModal 실패 테스트 작성

`tests/app/leave/request-leave-modal.test.tsx`:

```tsx
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
```

## Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/app/leave/request-leave-modal.test.tsx
```

기대: 모듈 `request-leave-modal`이 없어 import 실패(FAIL).

## Step 3 — RequestLeaveModal 구현

`src/app/(app)/leave/_components/request-leave-modal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LeaveFields, emptyLeaveForm, toLeavePayload, type LeaveFormState } from "./leave-fields";

export function RequestLeaveModal({
  onClose,
  defaultDate,
}: {
  onClose: () => void;
  defaultDate?: string;
}) {
  const [state, setState] = useState<LeaveFormState>({
    ...emptyLeaveForm,
    startDate: defaultDate ?? "",
    endDate: defaultDate ?? "",
  });
  const set = <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toLeavePayload(state)),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? `신청 실패 (${res.status})`,
        );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
  });

  const single = state.leaveType !== "ANNUAL";
  return (
    <Modal title="연차 신청" onClose={onClose}>
      <div className="space-y-3">
        <LeaveFields state={state} set={set} />
        {m.isError && (
          <p className="text-sm text-destructive">{(m.error as Error).message}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={m.isPending || !state.startDate || (!single && !state.endDate)}
            onClick={() => m.mutate()}
          >
            {m.isPending ? "신청 중…" : "신청"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

## Step 4 — CreateLeaveModal 종료일 기본값 추가

`src/app/(app)/leave/_components/create-leave-modal.tsx` — 초기 state를 다음으로 변경:

```tsx
  const [state, setState] = useState<LeaveFormState>({
    ...emptyLeaveForm,
    startDate: defaultDate ?? "",
    endDate: defaultDate ?? "",
  });
```

(현재는 `startDate`만 채운다. `endDate` 한 줄만 추가. 그 외 변경 없음.)

## Step 5 — 실행(PASS 확인) + 커밋

```bash
npm test -- tests/app/leave/request-leave-modal.test.tsx
npm run typecheck
npm run lint
```

기대: 테스트 2건 PASS, typecheck/lint clean.

커밋(변경 파일 명시 stage — 다른 세션 미커밋과 섞임 방지):

```bash
git add src/app/(app)/leave/_components/request-leave-modal.tsx tests/app/leave/request-leave-modal.test.tsx src/app/(app)/leave/_components/create-leave-modal.tsx
git commit -m "feat(leave): 자가신청 모달 RequestLeaveModal 신설 + 직접입력 모달 종료일 기본값"
```

## Acceptance Criteria

- `npm test -- tests/app/leave/request-leave-modal.test.tsx` → 2 passed.
- `npm run typecheck` → 에러 0.
- `npm run lint` → 에러 0.

## Cautions

- **Don't `LeaveFields`를 모달용으로 새로 만들지 말 것.** Reason: 기존 공유 컴포넌트를 재사용한다(CreateLeaveModal과 동일). 폼 필드 중복 금지.
- **Don't `LeaveRequestForm`(페이지 폼)이나 `/leave/request` 페이지를 수정하지 말 것.** Reason: 네비 메뉴 직접 진입 경로라 범위 밖. 캘린더 경로만 모달화한다.
- **Don't UserSelect·알림 체크박스를 추가하지 말 것.** Reason: 자가신청은 폼만(결정됨). 그건 관리자 모달(CreateLeaveModal) 전용이다.
