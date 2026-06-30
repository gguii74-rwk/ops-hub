# Task 05 — 작업 생성 모달 + 목록 버튼

목록 화면에 "새 대금청구 작업" 버튼(권한 게이트)과 생성 모달을 추가한다. 모달은 `POST /api/workflows { kind:"BILLING", scheduledAt }` → 성공 시 상세로 이동.

## Files

- Create: `src/app/(app)/workflows/create-task-modal.tsx`
- Modify: `src/app/(app)/workflows/workflows-list.tsx` — 버튼 + 모달 트리거
- Create (test): `tests/app/workflows/create-task-modal.test.tsx`
- Create (test): `tests/app/workflows/workflows-list.test.tsx`

## Prep

- 엔트리포인트 §SC-3(생성 페이로드)·§SC-9(`workflows.billing:create`)·§SC-11(모달·테스트 관례) 숙지.
- 모달은 `request-leave-modal` 패턴: `useMutation` + `Modal` + 제출 중 닫기 차단(guardedClose).
- 백엔드는 task-01에서 `kind` 수용 완료. 미지 kind·권한 없음 → 403 → 토스트.

## Deps

task-01 (생성 API `kind`).

## TDD steps

### Step 1 — create-task-modal 테스트 (RED)

`tests/app/workflows/create-task-modal.test.tsx`:

```tsx
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
```

Run: `npm test -- tests/app/workflows/create-task-modal.test.tsx` → **FAIL**(파일 없음).

### Step 2 — create-task-modal.tsx 구현

`src/app/(app)/workflows/create-task-modal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "BILLING", scheduledAt }),
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
    <Modal title="새 대금청구 작업" onClose={guardedClose}>
      <div className="space-y-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">유형</span>
          <Input value="대금청구" readOnly disabled />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">예정일</span>
          <Input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={m.isPending} onClick={guardedClose}>취소</Button>
          <Button disabled={m.isPending || !scheduledAt} onClick={() => m.mutate()}>
            {m.isPending ? "생성 중…" : "생성"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

Run: `npm test -- tests/app/workflows/create-task-modal.test.tsx` → **PASS**.

### Step 3 — workflows-list 버튼 게이트 테스트 (RED)

`tests/app/workflows/workflows-list.test.tsx`:

```tsx
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
```

Run: `npm test -- tests/app/workflows/workflows-list.test.tsx` → **FAIL**(버튼 없음).

### Step 4 — workflows-list.tsx에 버튼·모달 추가

`src/app/(app)/workflows/workflows-list.tsx` 수정(상단 import + 컴포넌트 본문):

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCan } from "@/lib/auth/permissions-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateTaskModal } from "./create-task-modal";
import { KIND_LABEL, STATUS_LABEL, STATUS_VARIANT, type WfStatus } from "./labels";
```

본문에서 필터 줄을 다음으로 교체(목록 ul·에러·빈 상태는 그대로 유지):

```tsx
export function WorkflowsList() {
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const canCreateBilling = useCan("workflows.billing", "create");
  const statuses = FILTERS.find((f) => f.key === filter)?.statuses;
  const query = useQuery({ queryKey: ["workflows", filter], queryFn: () => fetchList(statuses) });
  const items = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={f.key === filter ? "default" : "ghost"} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
        {canCreateBilling && (
          <Button className="ml-auto" size="sm" onClick={() => setCreating(true)}>새 대금청구 작업</Button>
        )}
      </div>

      {query.isError && <p className="text-sm text-destructive">목록을 불러오지 못했습니다.</p>}

      {items.length === 0 && !query.isLoading ? (
        <p className="text-sm text-muted-foreground">업무가 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {items.map((t) => (
            <li key={t.id}>
              <Link href={`/workflows/${t.id}`} className="flex items-center gap-3 p-3 hover:bg-muted">
                <Badge variant="outline">{KIND_LABEL[t.kind] ?? t.kind}</Badge>
                <span className="font-medium">{t.typeName}</span>
                <span className="text-sm text-muted-foreground">{new Date(t.scheduledAt).toLocaleDateString("ko-KR")}</span>
                <Badge className="ml-auto" variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateTaskModal onClose={() => setCreating(false)} />}
    </div>
  );
}
```

(`interface TaskItem`·`FILTERS`·`fetchList`는 기존 그대로 유지.)

Run: `npm test -- tests/app/workflows/workflows-list.test.tsx` → **PASS**.

## Acceptance Criteria

- `npm test -- tests/app/workflows/create-task-modal.test.tsx tests/app/workflows/workflows-list.test.tsx` → PASS.
- `npm run typecheck` / `npm run lint` → green.
- 전체 `npm test`·`npm run build` → green.

## Cautions

- **Don't** `typeId`를 전송하지 말 것 — `{ kind: "BILLING", scheduledAt }`만(task-01 계약, D12).
- **Don't** 제출 중 닫기를 허용하지 말 것(guardedClose) — in-flight POST 결과 유실 방지(기존 결정).
- **Don't** 버튼을 권한 없이 노출하지 말 것 — `useCan("workflows.billing","create")` 게이트(숨김=UX, API도 fail-closed).
