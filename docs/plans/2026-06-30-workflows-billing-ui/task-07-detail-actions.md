# Task 07 — 상세 액션 슬롯 (생성·다운로드·발송)

`workflow-detail.tsx`의 빈 액션 슬롯을 상태머신 기반 BILLING 액션으로 채운다(생성·개별/ZIP 다운로드·1·2단계 발송 모달). 재생성 없음(D10). BILLING 아닌 kind는 기존대로 빈 슬롯.

## Files

- Modify: `src/app/(app)/workflows/[id]/workflow-detail.tsx`
- Create (test): `tests/app/workflows/workflow-detail.test.tsx`

## Prep

- 엔트리포인트 §SC-4(Detail·effectiveRecipients)·§SC-10(상태→액션·step)·§SC-9(권한)·§SC-11 숙지.
- send-modal은 task-06(`./send-modal`). `effectiveRecipients`는 task-02가 detail에 `:send` 게이트로 노출 → prop으로 전달.
- 기존 진행이력·생성파일·메일 목록·취소·재시도/확정은 그대로 유지. 액션 슬롯은 `detail.kind === "BILLING"`일 때만.

## Deps

task-06 (send-modal). (런타임 prefill은 task-02 effectiveRecipients에 의존하나, prop이 undefined여도 동작 — 빈 수신자로 시작.)

## TDD steps

### Step 1 — workflow-detail 테스트 (RED)

`tests/app/workflows/workflow-detail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const detailData = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const can = vi.hoisted(() => ({ generate: false, send: false }));
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: detailData.current, isLoading: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock("@/lib/auth/permissions-client", () => ({
  useCan: (_r: string, a: string) => (a === "generate" ? can.generate : a === "send" ? can.send : false),
}));
vi.mock("@/app/(app)/workflows/[id]/send-modal", () => ({
  SendModal: (p: { step: number }) => <div data-testid="send-modal">step {p.step}</div>,
}));

import { WorkflowDetail } from "@/app/(app)/workflows/[id]/workflow-detail";

function baseDetail(over: Record<string, unknown> = {}) {
  return { id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: "2026-02-09T15:00:00.000Z", status: "PENDING", files: [], mailDeliveries: [], timeline: [], ...over };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); can.generate = false; can.send = false; invalidate.mockClear(); });

describe("WorkflowDetail 액션 슬롯(BILLING)", () => {
  it("PENDING + generate 권한 → '문서 생성' click 시 generate POST", async () => {
    can.generate = true;
    detailData.current = baseDetail({ status: "PENDING" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "문서 생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows/t1/generate", expect.objectContaining({ method: "POST" })));
  });

  it("generate 권한 없으면 '문서 생성' 미노출", () => {
    detailData.current = baseDetail({ status: "PENDING" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByRole("button", { name: "문서 생성" })).toBeNull();
  });

  it("GENERATED + send → 1단계 발송·ZIP·개별 다운로드, 재생성 없음(D10)", () => {
    can.send = true;
    detailData.current = baseDetail({
      status: "GENERATED",
      files: [{ id: "f1", displayName: "a.hwpx", mimeType: null, sizeBytes: 2048, createdAt: "2026-02-09T15:00:00.000Z" }],
    });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.getByRole("button", { name: "1단계 발송" })).toBeTruthy();
    expect(screen.getByText("전체 다운로드(ZIP)").closest("a")!.getAttribute("href")).toBe("/api/workflows/t1/download");
    expect(screen.queryByRole("button", { name: "문서 생성" })).toBeNull(); // 재생성 없음
    expect(screen.getByText("a.hwpx").closest("a")!.getAttribute("href")).toBe("/api/workflows/t1/files/f1");
  });

  it("GENERATED + send → 1단계 발송 클릭 시 SendModal(step 1)", () => {
    can.send = true;
    detailData.current = baseDetail({ status: "GENERATED" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "1단계 발송" }));
    expect(screen.getByTestId("send-modal").textContent).toContain("step 1");
  });

  it("GENERATED인데 send 권한 없으면 발송 버튼 미노출", () => {
    detailData.current = baseDetail({ status: "GENERATED" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByRole("button", { name: "1단계 발송" })).toBeNull();
  });

  it("SENT + send → 2단계 발송", () => {
    can.send = true;
    detailData.current = baseDetail({ status: "SENT" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.getByRole("button", { name: "2단계 발송" })).toBeTruthy();
  });

  it("HQ_REQUESTED → 후속 단계 안내, 발송 버튼 없음", () => {
    can.send = true;
    detailData.current = baseDetail({ status: "HQ_REQUESTED", files: [{ id: "f1", displayName: "a.hwpx", mimeType: null, sizeBytes: 1, createdAt: "x" }] });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.getByText(/최종발송.*후속/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /발송/ })).toBeNull();
  });

  it("BILLING 아닌 kind는 액션 슬롯 비노출", () => {
    can.send = true; can.generate = true;
    detailData.current = baseDetail({ kind: "WEEKLY_REPORT", status: "PENDING" });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByRole("button", { name: "문서 생성" })).toBeNull();
  });
});
```

Run: `npm test -- tests/app/workflows/workflow-detail.test.tsx` → **FAIL**(액션 슬롯·effectiveRecipients 없음).

### Step 2 — workflow-detail.tsx 전체 교체

`src/app/(app)/workflows/[id]/workflow-detail.tsx`(전체 내용):

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KIND_RESOURCE } from "@/modules/workflows/policy";
import { useCan } from "@/lib/auth/permissions-client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SendModal } from "./send-modal";
import {
  CANCELLABLE, KIND_LABEL, MAIL_LABEL, MAIL_VARIANT, STATUS_LABEL, STATUS_VARIANT,
  type MailStatus, type WfStatus,
} from "../labels";

interface TimelineEntry { id: string; fromStatus: WfStatus | null; toStatus: WfStatus; actorId: string | null; note: string | null; occurredAt: string; }
interface MailView { id: string; step: string | null; recipients: string[]; subject: string; status: MailStatus; errorMessage: string | null; sentAt: string | null; }
interface FileView { id: string; displayName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string; }
interface Detail {
  id: string; kind: string; typeName: string; scheduledAt: string; status: WfStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
  effectiveRecipients?: string[]; // :send 권한자에게만 백엔드가 포함(SC-4)
}

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
  const [sendStep, setSendStep] = useState<1 | 2 | null>(null);
  const query = useQuery({ queryKey: ["workflow", taskId], queryFn: () => fetchDetail(taskId) });
  const detail = query.data;
  // useCan은 무조건 호출(훅 규칙) — detail 전엔 임의 리소스로 false.
  const resource = detail ? (KIND_RESOURCE as Record<string, string>)[detail.kind] ?? "workflows.weekly" : "workflows.weekly";
  const canSend = useCan(resource, "send");
  const canGenerate = useCan(resource, "generate");

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
  const isBilling = detail.kind === "BILLING";
  const hasFiles = detail.files.length > 0;
  const downloadable = isBilling && hasFiles && ["GENERATED", "SENT", "HQ_REQUESTED"].includes(detail.status);

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

      {/* 액션 슬롯 — BILLING 한정 상태머신(§SC-10, 재생성 없음 D10). 타 kind는 빈 슬롯(별도 sub-project). */}
      {isBilling && (
        <div className="flex flex-wrap items-center gap-2">
          {detail.status === "PENDING" && canGenerate && (
            <Button size="sm" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/generate`)}>문서 생성</Button>
          )}
          {downloadable && (
            <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/workflows/${taskId}/download`}>
              전체 다운로드(ZIP)
            </a>
          )}
          {detail.status === "GENERATED" && canSend && (
            <Button size="sm" disabled={busy} onClick={() => setSendStep(1)}>1단계 발송</Button>
          )}
          {detail.status === "SENT" && canSend && (
            <Button size="sm" disabled={busy} onClick={() => setSendStep(2)}>2단계 발송</Button>
          )}
          {detail.status === "HQ_REQUESTED" && (
            <span className="text-sm text-muted-foreground">최종발송(3단계)은 후속 단계에서 지원합니다.</span>
          )}
        </div>
      )}

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

      {hasFiles && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">생성 파일</h2>
          <ul className="space-y-1">
            {detail.files.map((f) => (
              <li key={f.id} className="text-sm">
                {isBilling ? (
                  <a className="text-primary underline-offset-4 hover:underline" href={`/api/workflows/${taskId}/files/${f.id}`}>
                    {f.displayName}
                  </a>
                ) : (
                  f.displayName
                )}
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

      {sendStep != null && (
        <SendModal
          taskId={taskId}
          step={sendStep}
          scheduledAt={detail.scheduledAt}
          effectiveRecipients={detail.effectiveRecipients}
          onClose={() => setSendStep(null)}
        />
      )}
    </section>
  );
}
```

Run: `npm test -- tests/app/workflows/workflow-detail.test.tsx` → **PASS**.

## Acceptance Criteria

- `npm test -- tests/app/workflows/workflow-detail.test.tsx` → PASS(8케이스).
- `npm run typecheck` / `npm run lint` → green.
- 전체 `npm test`·`npm run build` → green.

## Cautions

- **Don't** GENERATED에 재생성/문서 생성 액션을 두지 말 것(D10). `문서 생성`은 PENDING에서만.
- **Don't** 액션 슬롯을 BILLING 외 kind에 렌더하지 말 것 — weekly/notification은 별도 sub-project(generate가 422). `isBilling` 가드 유지.
- **Don't** 발송/생성 버튼을 권한 없이 노출하지 말 것 — `canSend`/`canGenerate` 게이트.
- **Don't** 기존 진행이력·메일 재시도/확정·취소 로직을 바꾸지 말 것 — 빈 슬롯과 파일 링크만 추가.
- `useCan`/`useState`는 early-return 이전에 무조건 호출(훅 규칙) — 위 배치 유지.
