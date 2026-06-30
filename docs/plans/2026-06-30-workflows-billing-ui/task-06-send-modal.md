# Task 06 — 발송 모달 (1·2단계, prefill·fail-closed)

수신자·제목·본문을 편집해 `POST .../send`. 제목/본문은 단계별 템플릿 자동 prefill, 수신자는 detail `effectiveRecipients` prefill. **D6 fail-closed**: 빈 To는 발송 차단(fetch 미발생), 제출 시 화면 목록을 항상 명시 전달.

## Files

- Create: `src/app/(app)/workflows/[id]/send-modal.tsx`
- Create (test): `tests/app/workflows/send-modal.test.tsx`

## Prep

- 엔트리포인트 §SC-5(send 계약)·§SC-7(KST)·§SC-8(템플릿)·§SC-6(config DTO)·§SC-11 숙지.
- prefill 흐름(§4.4): scheduledAt → `computeBillingPeriod`로 projectYear → `GET config/[projectYear]`로 projectName → `buildSubject/buildBody` → 수신자 `effectiveRecipients`.
- `effectiveRecipients`는 task-02가 detail에 `:send` 게이트로 노출 → 부모(workflow-detail)가 prop으로 전달(task-07).
- `buildSubject`/`buildBody`/`plainToHtml`는 task-03(`../mail-templates`).

## Deps

task-02 (effectiveRecipients), task-03 (mail-templates).

## TDD steps

### Step 1 — send-modal 테스트 (RED) — D6 fail-closed 회귀 포함

`tests/app/workflows/send-modal.test.tsx`:

```tsx
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
```

Run: `npm test -- tests/app/workflows/send-modal.test.tsx` → **FAIL**(파일 없음).

### Step 2 — send-modal.tsx 구현

`src/app/(app)/workflows/[id]/send-modal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { computeBillingPeriod } from "@/modules/workflows/billing/period";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { buildSubject, buildBody, plainToHtml } from "../mail-templates";

const SEND_ERROR: Record<number, string> = {
  400: "입력 형식을 확인하세요.",
  403: "발송 권한이 없습니다.",
  409: "현재 상태에서 발송할 수 없습니다(이미 발송되었거나 취소됨).",
  422: "지원하지 않는 발송 단계입니다.",
};

export function SendModal({
  taskId, step, scheduledAt, effectiveRecipients, onClose,
}: {
  taskId: string; step: 1 | 2; scheduledAt: string; effectiveRecipients?: string[]; onClose: () => void;
}) {
  const { projectYear } = computeBillingPeriod(new Date(scheduledAt));
  const cfg = useQuery({
    queryKey: ["billing-config-year", projectYear],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/billing/config/${projectYear}`, { headers: { Accept: "application/json" } });
      if (res.status === 404) return { projectName: "" }; // 설정 없으면 빈 사업명(편집 가능)
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { projectName: string };
    },
  });

  if (cfg.isLoading) {
    return <Modal title={`${step}단계 발송`} onClose={onClose}><LoadingState /></Modal>;
  }
  // 일시 장애(404 아님)는 fail-closed: 사업명·제목·본문 템플릿을 신뢰할 수 없으므로 발송 폼을 띄우지 않는다(F-A2).
  // 404는 cfg.queryFn이 { projectName: "" }로 정상 처리 → isError=false(설정 없음=편집 경로, D5 보존).
  if (cfg.isError) {
    return (
      <Modal title={`${step}단계 발송`} onClose={onClose}>
        <ErrorState message="대금청구 설정을 불러오지 못했습니다. 잠시 후 다시 시도하세요." />
      </Modal>
    );
  }
  const projectName = cfg.data?.projectName ?? "";
  return (
    <SendForm
      taskId={taskId}
      step={step}
      scheduledAt={scheduledAt}
      projectName={projectName}
      projectNameMissing={projectName.trim() === ""}
      effectiveRecipients={effectiveRecipients}
      onClose={onClose}
    />
  );
}

function SendForm({
  taskId, step, scheduledAt, projectName, projectNameMissing, effectiveRecipients, onClose,
}: {
  taskId: string; step: 1 | 2; scheduledAt: string; projectName: string; projectNameMissing: boolean;
  effectiveRecipients?: string[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const ctx = { scheduledAt: new Date(scheduledAt), projectName };
  const [recipients, setRecipients] = useState((effectiveRecipients ?? []).join(", "));
  const [subject, setSubject] = useState(buildSubject(step, ctx));
  const [body, setBody] = useState(buildBody(step, ctx));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    // D6 fail-closed: 화면 표시 목록을 파싱해 빈 목록이면 발송 차단(fetch 미발생). 백엔드 폴백 미의존.
    const to = recipients.split(",").map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) { setError("수신자를 1명 이상 입력하세요."); return; }
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/workflows/${taskId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // recipients를 항상 명시 포함(화면 목록과 정확히 일치, 생략 없음 — D6). body는 HTML 변환.
        body: JSON.stringify({ step, subject, body: plainToHtml(body), recipients: to }),
      });
      if (!res.ok) { toast.error(SEND_ERROR[res.status] ?? "발송에 실패했습니다."); return; }
      toast.success("발송되었습니다.");
      await qc.invalidateQueries({ queryKey: ["workflow", taskId] });
      await qc.invalidateQueries({ queryKey: ["workflows"] });
      onClose();
    } finally { setSending(false); }
  }

  const guardedClose = () => { if (!sending) onClose(); };

  return (
    <Modal title={`${step}단계 발송`} onClose={guardedClose}>
      <div className="space-y-3">
        {projectNameMissing && (
          <p className="text-sm text-amber-600">이 연도의 대금청구 설정(사업명)이 없습니다 — 제목·본문의 사업명을 직접 확인·입력하세요.</p>
        )}
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">수신자 (쉼표 구분)</span>
          <Input aria-label="수신자" value={recipients} placeholder="name@example.com, ..." onChange={(e) => setRecipients(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">제목</span>
          <Input aria-label="제목" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">본문</span>
          <Textarea aria-label="본문" rows={12} className="font-mono text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        {step === 2 && <p className="text-sm text-muted-foreground">첨부 없음 — 서류 발급 요청 메일입니다.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={sending} onClick={guardedClose}>취소</Button>
          <Button disabled={sending} onClick={submit}>{sending ? "발송 중…" : "발송"}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

Run: `npm test -- tests/app/workflows/send-modal.test.tsx` → **PASS**.

## Acceptance Criteria

- `npm test -- tests/app/workflows/send-modal.test.tsx` → PASS(prefill·step2 안내·**fail-closed ①② **·409 토스트).
- `npm run typecheck` / `npm run lint` → green(app→module period import 허용).
- 전체 `npm test`·`npm run build` → green.

## Cautions

- **Don't** 빈 To로 POST를 보내지 말 것(D6) — 백엔드 폴백(오래된 기본 수신자)으로 대금청구 문서가 무음 발송될 위험. 빈 목록이면 fetch 전에 차단.
- **Don't** `recipients`를 생략하지 말 것 — 항상 화면 표시 목록을 명시 포함(생략 시 백엔드 폴백 의존 = D6 위반).
- **Don't** body를 plain text로 보내지 말 것 — `plainToHtml`로 변환(deliver가 html로 사용, 줄바꿈 보존).
- **Don't** 제출 중 닫기 허용하지 말 것(guardedClose).
- config 404는 오류가 아니다 — projectName "" 로 폼을 띄우고 사용자가 채운다(발송 차단 아님, D5 편집 경로). **단 사업명 공백을 명시 경고로 띄운다**(F-A2 — 공식 메일이 빈 사업명으로 무심코 발송되지 않게).
- **Don't** config **일시 장애(404 아님)**에 발송 폼을 그대로 띄우지 말 것(F-A2 fail-closed) — 제목·본문 템플릿이 신뢰 불가(빈 사업명)다. `cfg.isError`면 `ErrorState`로 차단하고 발송 버튼 자체를 렌더하지 않는다. 차단 경계: **404=편집 가능 / 일시오류=차단 / 빈 수신자=차단**.
