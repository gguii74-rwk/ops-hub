# Task 11 — UI: 목록 + timeline shell ([id])

`/workflows` 목록과 `/workflows/[id]` 상세(timeline + 파일 + 메일 + 취소/재시도/해소 액션)를 만든다. 생성·발송·미리보기 버튼은 **slot**(후속 sub-project가 채움). React Query·기존 ui 프리미티브 재사용.

## Files

- Create: `src/app/(app)/workflows/labels.ts` (상태·종류 라벨/배지 — 목록·상세 공유)
- Modify: `src/app/(app)/workflows/page.tsx` (서버: 권한 kind 계산 → 목록)
- Create: `src/app/(app)/workflows/workflows-list.tsx` (client: 목록 React Query)
- Create: `src/app/(app)/workflows/[id]/page.tsx` (서버: id·isAdmin 전달)
- Create: `src/app/(app)/workflows/[id]/workflow-detail.tsx` (client: 상세·timeline·액션)

## Prep

- 엔트리포인트 §Shared Contracts **SC-3**(`KIND_RESOURCE`), **SC-6**(`TaskDetailView`/`TaskListItem` 형태), **SC-9**(API 경로).
- 패턴: `src/app/(app)/calendar/page.tsx`(서버에서 권한 뷰 계산), `src/app/(app)/calendar/calendar-view.tsx`(React Query·fetch·invalidate), `useCan`(`src/lib/auth/permissions-client.tsx`).
- ui 프리미티브: `Button`(variant default/outline/secondary/ghost/destructive, size sm), `Badge`(variant default/secondary/outline/destructive).
- 테스트 환경은 node(jsdom 없음) → 컴포넌트 단위 테스트 없음. 게이트는 `typecheck`/`lint`/`build` + 수동 확인.

## Deps

- Task 09(API). (`KIND_RESOURCE`는 Task 02 — policy.ts는 server-only가 아니라 client 임포트 안전.)

## Step 1 — labels.ts

생성: `src/app/(app)/workflows/labels.ts`

```ts
export type WfStatus = "PENDING" | "GENERATED" | "REVIEWED" | "SENT" | "HQ_REQUESTED" | "FINAL_SENT" | "CANCELLED";
export type MailStatus = "SENDING" | "SENT" | "FAILED";
type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export const KIND_LABEL: Record<string, string> = {
  WEEKLY_REPORT: "주간보고",
  BILLING: "대금청구",
  NOTIFICATION_BILLING: "알림톡",
};

export const STATUS_LABEL: Record<WfStatus, string> = {
  PENDING: "대기", GENERATED: "생성됨", REVIEWED: "검토됨", SENT: "발송됨",
  HQ_REQUESTED: "본사요청", FINAL_SENT: "최종발송", CANCELLED: "취소됨",
};
export const STATUS_VARIANT: Record<WfStatus, BadgeVariant> = {
  PENDING: "outline", GENERATED: "secondary", REVIEWED: "secondary", SENT: "default",
  HQ_REQUESTED: "secondary", FINAL_SENT: "default", CANCELLED: "destructive",
};

// 메일 배지: SENDING은 '확인 필요'(발송 불확실)로 표시(spec §10).
export const MAIL_LABEL: Record<MailStatus, string> = { SENDING: "확인 필요", SENT: "발송됨", FAILED: "실패" };
export const MAIL_VARIANT: Record<MailStatus, BadgeVariant> = { SENDING: "outline", SENT: "default", FAILED: "destructive" };

// 취소 가능 상태(서버가 최종 권위 — UI는 힌트). terminal·발송 이후는 숨김.
export const CANCELLABLE: WfStatus[] = ["PENDING", "GENERATED", "REVIEWED"];
```

## Step 2 — 목록 페이지(서버)

`src/app/(app)/workflows/page.tsx` 전체 교체:

```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { KIND_RESOURCE } from "@/modules/workflows/policy";
import type { WorkflowKind } from "@prisma/client";
import { WorkflowsList } from "./workflows-list";

const KINDS: WorkflowKind[] = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING"];

export default async function WorkflowsPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const keySet = new Set(keys);
  const allowed = KINDS.filter((k) => keySet.has(`${KIND_RESOURCE[k]}:view`));

  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">업무</h1>
      {allowed.length === 0 ? (
        <p className="text-sm text-muted-foreground">열람 권한이 있는 업무가 없습니다.</p>
      ) : (
        <WorkflowsList />
      )}
    </section>
  );
}
```

## Step 3 — 목록(client)

생성: `src/app/(app)/workflows/workflows-list.tsx`

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, STATUS_LABEL, STATUS_VARIANT, type WfStatus } from "./labels";

interface TaskItem { id: string; kind: string; typeName: string; scheduledAt: string; status: WfStatus; }

const FILTERS: Array<{ key: string; label: string; statuses?: string }> = [
  { key: "all", label: "전체" },
  { key: "active", label: "진행중", statuses: "PENDING,GENERATED,REVIEWED" },
  { key: "sent", label: "발송", statuses: "SENT,FINAL_SENT" },
];

async function fetchList(statuses?: string): Promise<TaskItem[]> {
  const qs = statuses ? `?status=${statuses}` : "";
  const res = await fetch(`/api/workflows${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`list ${res.status}`);
  return (await res.json()).items as TaskItem[];
}

export function WorkflowsList() {
  const [filter, setFilter] = useState("all");
  const statuses = FILTERS.find((f) => f.key === filter)?.statuses;
  const query = useQuery({ queryKey: ["workflows", filter], queryFn: () => fetchList(statuses) });
  const items = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={f.key === filter ? "default" : "ghost"} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
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
    </div>
  );
}
```

## Step 4 — 상세 페이지(서버)

생성: `src/app/(app)/workflows/[id]/page.tsx`

```tsx
import { auth } from "@/lib/auth";
import { WorkflowDetail } from "./workflow-detail";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user?.systemRole;
  const isAdmin = role === "OWNER" || role === "ADMIN";
  return <WorkflowDetail taskId={id} isAdmin={isAdmin} />;
}
```

## Step 5 — 상세(client, timeline shell)

생성: `src/app/(app)/workflows/[id]/workflow-detail.tsx`

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KIND_RESOURCE } from "@/modules/workflows/policy";
import { useCan } from "@/lib/auth/permissions-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CANCELLABLE, KIND_LABEL, MAIL_LABEL, MAIL_VARIANT, STATUS_LABEL, STATUS_VARIANT,
  type MailStatus, type WfStatus,
} from "../labels";

interface TimelineEntry { id: string; fromStatus: WfStatus | null; toStatus: WfStatus; actorId: string | null; note: string | null; occurredAt: string; }
interface MailView { id: string; step: string | null; recipients: string[]; subject: string; status: MailStatus; errorMessage: string | null; sentAt: string | null; }
interface FileView { id: string; displayName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string; }
interface Detail { id: string; kind: string; typeName: string; scheduledAt: string; status: WfStatus; files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[]; }

async function fetchDetail(id: string): Promise<Detail | null> {
  const res = await fetch(`/api/workflows/${id}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`detail ${res.status}`);
  return res.json() as Promise<Detail>;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

export function WorkflowDetail({ taskId, isAdmin }: { taskId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["workflow", taskId], queryFn: () => fetchDetail(taskId) });
  const detail = query.data;
  // useCan은 무조건 호출(훅 규칙) — detail 전엔 임의 리소스로 false.
  const canSend = useCan(detail ? KIND_RESOURCE[detail.kind] ?? "workflows.weekly" : "workflows.weekly", "send");

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        alert(`작업 실패 (${res.status})`);
      }
      await qc.invalidateQueries({ queryKey: ["workflow", taskId] });
      await qc.invalidateQueries({ queryKey: ["workflows"] });
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (query.isError) return <p className="text-sm text-destructive">상세를 불러오지 못했습니다.</p>;
  if (!detail) return <p className="text-sm text-muted-foreground">작업을 찾을 수 없습니다.</p>;

  const cancellable = CANCELLABLE.includes(detail.status);

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/workflows" className="text-sm text-muted-foreground hover:underline">← 목록</Link>
        <Badge variant="outline">{KIND_LABEL[detail.kind] ?? detail.kind}</Badge>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{detail.typeName}</h1>
        <Badge variant={STATUS_VARIANT[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
        <span className="text-sm text-muted-foreground">{new Date(detail.scheduledAt).toLocaleDateString("ko-KR")}</span>
        {cancellable && (
          <Button className="ml-auto" size="sm" variant="destructive" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/cancel`)}>
            취소
          </Button>
        )}
      </div>

      {/* 생성/발송/미리보기 버튼 slot — 후속 워크플로 sub-project가 채운다. */}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">진행 이력</h2>
        <ol className="space-y-1 border-l border-border pl-4">
          {detail.timeline.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="font-medium">{e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}{STATUS_LABEL[e.toStatus]}</span>
              <span className="text-muted-foreground"> · {fmt(e.occurredAt)}{e.actorId ? ` · ${e.actorId}` : ""}</span>
              {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
            </li>
          ))}
        </ol>
      </div>

      {detail.files.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">생성 파일</h2>
          <ul className="space-y-1">
            {detail.files.map((f) => (
              <li key={f.id} className="text-sm">
                {f.displayName}
                {f.sizeBytes != null && <span className="text-muted-foreground"> · {Math.round(f.sizeBytes / 1024)} KB</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">메일 발송</h2>
        {detail.mailDeliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">발송 이력 없음</p>
        ) : (
          <ul className="space-y-2">
            {detail.mailDeliveries.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
                <Badge variant={MAIL_VARIANT[m.status]}>{MAIL_LABEL[m.status]}</Badge>
                <span className="font-medium">{m.subject}</span>
                <span className="text-muted-foreground">{m.recipients.join(", ")}</span>
                {m.errorMessage && <span className="text-destructive">{m.errorMessage}</span>}
                {m.status === "FAILED" && canSend && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/mail/${m.id}/retry`)}>
                    재시도
                  </Button>
                )}
                {m.status === "SENDING" && isAdmin && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/mail/${m.id}/resolve`, { to: "SENT" })}>발송됨 확정</Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/mail/${m.id}/resolve`, { to: "FAILED" })}>실패 확정</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

## Step 6 — 검증

```bash
npm run typecheck
npm run lint
npm run build      # 서버/클라이언트 경계·RSC 컴파일 — UI 태스크의 핵심 게이트
```

## Step 7 — 수동 확인 (DB 연결 시)

```bash
npm run db:seed && npm run db:seed:demo   # 데모 데이터
npm run dev
# /workflows: 목록·필터·상태 배지. /workflows/sample-task-2: FAILED 메일 재시도 버튼.
# /workflows/sample-task-4: SENDING '확인 필요' + (admin) 확정 버튼. /workflows/sample-task-1: 취소 버튼.
```

## Step 8 — commit

```bash
git add "src/app/(app)/workflows" 
git commit -m "feat(workflows): list + timeline shell UI (status badges, cancel/retry/resolve actions)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과
npm run build       # 통과(client/server 경계 위반·server-only 누수 없음)
npm test            # 전체 통과(회귀 없음)
```

## Cautions

- **생성/발송/미리보기 버튼을 여기서 구현하지 말 것** — slot 주석만 남긴다. 워크플로 sub-project가 채운다(spec §10).
- **`useCan`을 조건부로 호출하지 말 것**(훅 규칙). detail 로딩 전엔 임의 리소스로 호출해 false를 받는다.
- 재시도 버튼은 `FAILED` + `canSend`에만, resolve 버튼은 `SENDING` + `isAdmin`에만 노출(spec §10). `SENDING`은 일반 사용자에게 '확인 필요' 배지로만 보인다.
- 취소 버튼 노출은 UI 힌트일 뿐 — 본인/admin·SENDING 차단은 서버 게이트가 최종 판정한다(access 규칙 1). createdById를 클라이언트로 내려 판정하려 하지 말 것.
- `KIND_RESOURCE`는 policy.ts(순수 데이터, server-only 아님)에서 import — client 번들 안전. `@/modules/workflows` service/repository(server-only·Prisma)를 client 컴포넌트에서 import하지 말 것(build 깨짐).
