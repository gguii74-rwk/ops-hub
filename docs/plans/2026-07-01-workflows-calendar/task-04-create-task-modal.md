# Task 04 — 생성 모달 일반화 (작업유형 드롭다운 권한 게이트 · 예정일 prefill)

`create-task-modal.tsx`를 BILLING 고정에서 **5종 예약(수준 B)** 일반 모달로 확장한다: 권한 있는 유형만 `Select` 옵션, 클릭 날짜 prefill, `POST /api/workflows {kind, scheduledAt}`(기존 계약), `guardedClose` 유지.

## Files
- Modify: `src/app/(app)/workflows/create-task-modal.tsx` (전면 확장)
- Test: `tests/app/workflows/create-task-modal.test.tsx` (게이트·prefill·payload 갱신)

## Prep
- 엔트리포인트 §Shared Contracts SC-4(생성 계약 불변), SC-5(라벨·순서), SC-2(KIND_RESOURCE).
- 참조: 기존 `create-task-modal.tsx`(guardedClose·useMutation·toast 관례), `src/components/ui/select.tsx`(native `<select>` 래퍼), `src/lib/auth/permissions-client.tsx`(`useCan`).
- D10(생성 모달 일반화), 접근제어 규칙①(UI `useCan` + 서버 `createTask` 동일 키).

## Deps
- Task 01(`KIND_RESOURCE`·`WORKFLOW_KINDS`), Task 02(`KIND_LABEL`·`WORKFLOW_KIND_ORDER`).

## Cautions
- **Don't `useCan`을 배열 콜백/조건문 안에서 호출하지 마라.** react-hooks 규칙 위반. 5종을 **고정 개수로 명시 호출**한 뒤 `Record<WorkflowKind,boolean>`으로 모아 필터한다(완전매핑이라 kind 추가 시 typecheck가 강제).
- **Don't POST 계약을 바꾸지 마라.** body는 `{ kind, scheduledAt }` 그대로(billing-ui D12, 서버 라우트/스키마 불변).
- **Don't 옵션 0개일 때 크래시하지 마라.** 트리거(task-05 캘린더)가 이미 게이트하지만, 방어적으로 옵션 0개면 안내 문구 + 생성 비활성.
- **Don't `guardedClose`(제출 중 닫기 차단)를 제거하지 마라.** in-flight 결과 보존(기존 모달 결정).

## TDD Steps

### 1. 테스트 갱신 — 실패부터

`tests/app/workflows/create-task-modal.test.tsx`를 아래로 교체(권한 mock을 kind별로, dropdown·prefill·payload 검증):

```tsx
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
```

실행: `npm test -- tests/app/workflows/create-task-modal.test.tsx` → **FAIL**(모달이 BILLING 고정).

### 2. 모달 구현

`src/app/(app)/workflows/create-task-modal.tsx` 전면 교체:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WorkflowKind } from "@prisma/client";
import { useCan } from "@/lib/auth/permissions-client";
import { KIND_RESOURCE } from "@/modules/workflows/policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { KIND_LABEL, WORKFLOW_KIND_ORDER } from "./labels";

export function CreateTaskModal({ defaultDate, onClose }: { defaultDate?: string; onClose: () => void }) {
  const router = useRouter();
  // useCan은 고정 개수로 호출(react-hooks 규칙). 완전매핑 Record라 kind 추가 시 typecheck가 강제.
  const canCreate: Record<WorkflowKind, boolean> = {
    BILLING: useCan("workflows.billing", "create"),
    NOTIFICATION_BILLING: useCan("workflows.notification", "create"),
    WEEKLY_REPORT: useCan("workflows.weekly", "create"),
    WEEKLY_REPORT_CLIENT: useCan("workflows.weeklyClient", "create"),
    MONTHLY_REPORT_CLIENT: useCan("workflows.monthlyClient", "create"),
  };
  const options = WORKFLOW_KIND_ORDER.filter((k) => canCreate[k]);

  const [kind, setKind] = useState<WorkflowKind | "">(options[0] ?? "");
  const [scheduledAt, setScheduledAt] = useState(defaultDate ?? "");

  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, scheduledAt }),
      });
      if (!res.ok) {
        throw new Error(res.status === 403 ? "작업 생성 권한이 없습니다." : `생성 실패 (${res.status})`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: (data) => { onClose(); router.push(`/workflows/${data.id}`); },
    onError: (e) => { toast.error((e as Error).message); },
  });
  // 제출 중 닫기 차단(in-flight 결과 보존 — 기존 모달 관례).
  const guardedClose = () => { if (!m.isPending) onClose(); };

  return (
    <Modal title="새 작업 등록" onClose={guardedClose}>
      <div className="space-y-3">
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">작업을 생성할 권한이 있는 유형이 없습니다.</p>
        ) : (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">유형</span>
            <Select
              aria-label="유형"
              value={kind}
              onChange={(e) => setKind(e.target.value as WorkflowKind)}
            >
              {options.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
          </label>
        )}
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">예정일</span>
          <Input
            aria-label="예정일"
            type="date"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={m.isPending} onClick={guardedClose}>취소</Button>
          <Button disabled={m.isPending || !scheduledAt || !kind} onClick={() => m.mutate()}>
            {m.isPending ? "생성 중…" : "생성"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

실행: `npm test -- tests/app/workflows/create-task-modal.test.tsx` → **PASS**.

### 3. 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/app/workflows/create-task-modal.test.tsx
```
기대: 전부 green. 이후 커밋.

## Acceptance Criteria
- `npm run typecheck` → 통과(`Record<WorkflowKind,boolean>` 완전매핑).
- `npm run lint` → 통과(react-hooks/rules-of-hooks 위반 없음 — useCan 고정 호출).
- `npm test -- tests/app/workflows/create-task-modal.test.tsx` → 통과.
- 옵션 = `WORKFLOW_KIND_ORDER` 중 `useCan(resource,"create")` true인 것; 0개면 안내+생성 비활성; 1개면 고정.
- 제출 payload = `{ kind, scheduledAt }`; 403 토스트; `guardedClose` 유지.
