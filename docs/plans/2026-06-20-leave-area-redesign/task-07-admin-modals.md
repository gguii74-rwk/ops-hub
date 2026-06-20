# Task 07 — 관리자 모달(직접입력/수정/삭제) + 사용자목록 API

**목적:** 원본 `CreateLeaveModal`/`EditLeaveModal`을 ops-hub UI로 포팅한다. 사용자 선택 드롭다운(활성 사용자 목록 API), 반반차 6종 시간대, 이메일 알림 체크박스, 수정·soft-delete를 제공한다. 모달은 Task 10(내역)·11(캘린더)에서 사용.

## Files
- Create: `src/modules/leave/services/users.ts` (listActiveUsers)
- Create: `src/app/api/admin/leave/users/route.ts`
- Create: `src/app/(app)/leave/_components/modal.tsx`
- Create: `src/app/(app)/leave/_components/user-select.tsx`
- Create: `src/app/(app)/leave/_components/leave-fields.tsx` (create/edit 공유 폼)
- Create: `src/app/(app)/leave/_components/create-leave-modal.tsx`
- Create: `src/app/(app)/leave/_components/edit-leave-modal.tsx`
- Create: `tests/app/admin-leave-users-route.test.ts`

## Prep
- 엔트리포인트 §SC-5(QUARTER_TIME_SLOTS), §SC-2(사용자목록=`leave.approval:approve`), §SC-1(라우트 패턴).
- 원본: `C:\workspace\annual-leave\frontend\src\components\admin\CreateLeaveModal.tsx`·`EditLeaveModal.tsx`(필드 구성·페이로드).
- UI 프리미티브: `@/components/ui/{button,card,input,label,textarea}`. **Dialog 컴포넌트는 없음** → 자체 overlay(modal.tsx).
- 제출 대상: 직접입력 `POST /api/admin/leave/requests`(Task 06이 sendNotification 처리), 수정 `PATCH /api/admin/leave/requests/[id]`, 삭제 `DELETE`(body `{reason}`).

## Deps
Task 02(labels·QUARTER_TIME_SLOTS), Task 06(직접입력 sendNotification·soft-delete·target 재검증 — 모달의 서버 계약).

## Steps

### 1. (TDD) 사용자목록 라우트 가드 → FAIL→PASS

`tests/app/admin-leave-users-route.test.ts`(Task 05 라우트 테스트 패턴):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const authMock = vi.fn();
const requirePermissionMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/kernel/access", () => ({ requirePermission: requirePermissionMock, ForbiddenError: class ForbiddenError extends Error {} }));
vi.mock("@/modules/leave/services/users", () => ({ listActiveUsers: vi.fn(async () => []) }));
import { GET } from "@/app/api/admin/leave/users/route";
beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/leave/users", () => {
  it("미인증 401", async () => { authMock.mockResolvedValue(null); expect((await GET()).status).toBe(401); });
  it("leave.approval:approve로 가드", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    requirePermissionMock.mockResolvedValue(undefined);
    expect((await GET()).status).toBe(200);
    expect(requirePermissionMock).toHaveBeenCalledWith("u1", "leave.approval", "approve");
  });
});
```

### 2. service + route

`src/modules/leave/services/users.ts`:
```ts
import "server-only";
import { prisma } from "@/lib/prisma";

// 직접입력 대상 후보(활성 사용자). PII·target id 과노출 방지 위해 라우트는 leave.approval:approve로 가드.
export function listActiveUsers() {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, department: true, email: true },
    orderBy: { name: "asc" },
  });
}
```
`src/app/api/admin/leave/users/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/kernel/access";
import { listActiveUsers } from "@/modules/leave/services/users";
import { mapError } from "@/app/api/leave/_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await requirePermission(session.user.id, "leave.approval", "approve");
    const items = await listActiveUsers();
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### 3. modal overlay
`src/app/(app)/leave/_components/modal.tsx`:
```tsx
"use client";
import { Card } from "@/components/ui/card";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        {children}
      </Card>
    </div>
  );
}
```

### 4. user-select
`src/app/(app)/leave/_components/user-select.tsx`:
```tsx
"use client";
import { useQuery } from "@tanstack/react-query";

export interface LeaveUser { id: string; name: string; department: string | null; email: string }

export function useLeaveUsers() {
  return useQuery({
    queryKey: ["admin-leave", "users"],
    queryFn: async (): Promise<LeaveUser[]> => {
      const res = await fetch("/api/admin/leave/users", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`users ${res.status}`);
      return (await res.json()).items as LeaveUser[];
    },
  });
}

export function UserSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data = [], isLoading } = useLeaveUsers();
  return (
    <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{isLoading ? "불러오는 중…" : "사용자를 선택하세요"}</option>
      {data.map((u) => (
        <option key={u.id} value={u.id}>{u.name} - {u.department ?? "-"} ({u.email})</option>
      ))}
    </select>
  );
}
```

### 5. 공유 폼 필드(반반차 6종 핵심)
`src/app/(app)/leave/_components/leave-fields.tsx`:
```tsx
"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QUARTER_TIME_SLOTS } from "@/modules/leave/labels";

export interface LeaveFormState {
  leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType: "MORNING" | "AFTERNOON";
  quarterStartTime: string;
  startDate: string;
  endDate: string;
  reason: string;
}
export const emptyLeaveForm: LeaveFormState = { leaveType: "ANNUAL", leaveSubType: "MORNING", quarterStartTime: "09:00", startDate: "", endDate: "", reason: "" };

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export function LeaveFields({ state, set }: { state: LeaveFormState; set: <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) => void }) {
  const single = state.leaveType !== "ANNUAL";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label>유형</Label>
        <select className={selectCls} value={state.leaveType} onChange={(e) => set("leaveType", e.target.value as LeaveFormState["leaveType"])}>
          <option value="ANNUAL">연차</option>
          <option value="HALF">반차(0.5)</option>
          <option value="QUARTER">반반차(0.25)</option>
        </select>
      </div>
      {state.leaveType === "HALF" && (
        <div className="space-y-1">
          <Label>반차 시간대</Label>
          <select className={selectCls} value={state.leaveSubType} onChange={(e) => set("leaveSubType", e.target.value as "MORNING" | "AFTERNOON")}>
            <option value="MORNING">오전 반차</option>
            <option value="AFTERNOON">오후 반차</option>
          </select>
        </div>
      )}
      {state.leaveType === "QUARTER" && (
        <div className="space-y-1">
          <Label>시간대</Label>
          <select className={selectCls} value={state.quarterStartTime} onChange={(e) => set("quarterStartTime", e.target.value)}>
            {QUARTER_TIME_SLOTS.map((s) => <option key={s.start} value={s.start}>{s.label}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <Label>{single ? "날짜" : "시작일"}</Label>
        <Input type="date" value={state.startDate} onChange={(e) => set("startDate", e.target.value)} />
      </div>
      {!single && (
        <div className="space-y-1">
          <Label>종료일</Label>
          <Input type="date" value={state.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
      )}
      <div className="space-y-1 sm:col-span-2">
        <Label>사유(선택)</Label>
        <Textarea rows={2} value={state.reason} onChange={(e) => set("reason", e.target.value)} />
      </div>
    </div>
  );
}

// 폼 상태 → API 페이로드(single이면 endDate=startDate, 유형별 sub 필드 정리).
export function toLeavePayload(s: LeaveFormState) {
  const single = s.leaveType !== "ANNUAL";
  return {
    leaveType: s.leaveType,
    leaveSubType: s.leaveType === "HALF" ? s.leaveSubType : undefined,
    quarterStartTime: s.leaveType === "QUARTER" ? s.quarterStartTime : undefined,
    startDate: s.startDate,
    endDate: single ? s.startDate : s.endDate,
    reason: s.reason || undefined,
  };
}
```

### 6. create-leave-modal
`src/app/(app)/leave/_components/create-leave-modal.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "./modal";
import { UserSelect } from "./user-select";
import { LeaveFields, emptyLeaveForm, toLeavePayload, type LeaveFormState } from "./leave-fields";

export function CreateLeaveModal({ onClose, defaultDate }: { onClose: () => void; defaultDate?: string }) {
  const [userId, setUserId] = useState("");
  const [sendNotification, setSendNotification] = useState(false);
  const [state, setState] = useState<LeaveFormState>({ ...emptyLeaveForm, startDate: defaultDate ?? "" });
  const set = <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) => setState((s) => ({ ...s, [k]: v }));
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/leave/requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, sendNotification, ...toLeavePayload(state) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `등록 실패 (${res.status})`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-leave"] }); qc.invalidateQueries({ queryKey: ["leave"] }); onClose(); },
  });
  const single = state.leaveType !== "ANNUAL";
  return (
    <Modal title="연차 직접 입력" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1"><Label>사용자</Label><UserSelect value={userId} onChange={setUserId} /></div>
        <LeaveFields state={state} set={set} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendNotification} onChange={(e) => setSendNotification(e.target.checked)} />
          사용자에게 이메일 알림 발송
        </label>
        {m.isError && <p className="text-sm text-destructive">{(m.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button disabled={m.isPending || !userId || !state.startDate || (!single && !state.endDate)} onClick={() => m.mutate()}>
            {m.isPending ? "등록 중…" : "등록"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

### 7. edit-leave-modal
`src/app/(app)/leave/_components/edit-leave-modal.tsx` — 기존 신청을 받아 수정/삭제:
```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "./modal";
import { LeaveFields, toLeavePayload, type LeaveFormState } from "./leave-fields";

export interface EditTarget {
  id: string; leaveType: "ANNUAL" | "HALF" | "QUARTER"; leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null; startDate: string; endDate: string; reason: string | null;
}

export function EditLeaveModal({ target, onClose }: { target: EditTarget; onClose: () => void }) {
  const [state, setState] = useState<LeaveFormState>({
    leaveType: target.leaveType,
    leaveSubType: target.leaveSubType ?? "MORNING",
    quarterStartTime: target.quarterStartTime ?? "09:00",
    startDate: target.startDate.slice(0, 10),
    endDate: target.endDate.slice(0, 10),
    reason: target.reason ?? "",
  });
  const [adminActionNote, setNote] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false); // 2단계 확인(오클릭 방지, spec §7)
  const set = <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) => setState((s) => ({ ...s, [k]: v }));
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["admin-leave"] }); qc.invalidateQueries({ queryKey: ["leave"] }); };

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/leave/requests/${target.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toLeavePayload(state), adminActionNote: adminActionNote || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `수정 실패 (${res.status})`);
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  const del = useMutation({
    mutationFn: async () => {
      const reason = deleteReason.trim();
      if (!reason) throw new Error("삭제 사유를 입력하세요."); // 사유 필수(되돌릴 수 없는 작업)
      const res = await fetch(`/api/admin/leave/requests/${target.id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `삭제 실패 (${res.status})`);
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  return (
    <Modal title="연차 수정" onClose={onClose}>
      <div className="space-y-3">
        <LeaveFields state={state} set={set} />
        <div className="space-y-1"><Label>수정 사유(선택)</Label><Input value={adminActionNote} onChange={(e) => setNote(e.target.value)} /></div>
        {(save.isError || del.isError) && <p className="text-sm text-destructive">{((save.error || del.error) as Error)?.message}</p>}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* 삭제: 사유 필수 + 2단계 확인(첫 클릭은 확인 진입만, 실제 DELETE는 '삭제 확인'에서). 오클릭 방지(finding, spec §7). */}
            <Input className="w-40" placeholder="삭제 사유(필수)" value={deleteReason}
              onChange={(e) => { setDeleteReason(e.target.value); setConfirmingDelete(false); }} />
            {!confirmingDelete ? (
              <Button variant="destructive" disabled={!deleteReason.trim()} onClick={() => setConfirmingDelete(true)}>삭제</Button>
            ) : (
              <>
                <span className="text-sm text-destructive">되돌릴 수 없습니다.</span>
                <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>취소</Button>
                <Button variant="destructive" disabled={del.isPending || !deleteReason.trim()} onClick={() => del.mutate()}>{del.isPending ? "삭제 중…" : "삭제 확인"}</Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>취소</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "저장"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
```

## Acceptance Criteria
- `npx vitest run tests/app/admin-leave-users-route.test.ts` → passed.
- `npm run build` / `npm run typecheck` / `npm run lint` → 통과.
- `npm test` → 회귀 없음.
- **EditLeaveModal 삭제 흐름 테스트(finding):** 삭제 사유가 비면 "삭제" 버튼 disabled; 첫 클릭은 확인 상태로만 진입하고 **DELETE fetch가 일어나지 않음**(`global.fetch` mock 미호출 단언); "삭제 확인"을 눌러야 DELETE 발사. (오클릭 1회로 soft-delete되지 않음.)
- (수동 확인 포인트, Task 10/11 통합 후) 직접입력 시 사용자 드롭다운 `이름 - 부서 (이메일)` 표시, 반반차 6종 라벨, 알림 체크박스 동작.

## Cautions
- **Don't** 사용자목록 API를 `leave.approval:view`로 가드하지 마라. 이유: 읽기전용 approver에게 전 직원 PII·target id가 과노출된다 — 직접입력 수행 권한(`leave.approval:approve`)과 동일하게(spec §7 finding).
- **Don't** 삭제 버튼이 물리삭제 API를 호출하게 만들지 마라. 이유: 서버는 soft-delete(Task 06) — DELETE는 `{reason}` body를 보낸다.
- **Don't** 모달에서 클라이언트 검증만 믿지 마라. 서버(zod 6종 화이트리스트·필수 규칙, target 재검증)가 권위다 — 클라이언트는 UX 보조.
