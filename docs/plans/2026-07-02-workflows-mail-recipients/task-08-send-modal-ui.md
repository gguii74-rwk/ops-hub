# Task 08 — 발송 모달 3필드 + 상세 UI cc/bcc 표시

발송 모달을 수신자/참조/숨은참조 3필드로 확장(prefill = `effectiveRecipients[step]`, 이름 힌트)하고, 상세 이력에 cc/bcc를 표시한다.

## Files
- Modify: `src/app/(app)/workflows/[id]/send-modal.tsx`
- Modify: `src/app/(app)/workflows/[id]/workflow-detail.tsx`
- Test: `tests/app/workflows/send-modal.test.tsx` (prop 형태·3필드 케이스로 갱신)
- Test: `tests/app/workflows/workflow-detail.test.tsx` (cc/bcc 표시·prefill 전달 케이스 추가)

## Prep
- 엔트리포인트 §SC-2(`EffectiveRecipientFields`·`RecipientEntry` 타입), §SC-11(UI 계약).
- 참조: `tests/app/workflows/send-modal.test.tsx`(cfgState·fetch stub 관례), `tests/app/workflows/workflow-detail.test.tsx`(detailData·SendModal mock 관례).

## Deps
- Task 04(라우트가 cc/bcc 수용), Task 07(effectiveRecipients 맵 — 동시 교체 계약).

## Cautions
- **Don't 백엔드 폴백에 기대 to를 생략하지 마라.** Reason: D6 — 화면 목록을 **항상 명시 전송**(recipients+cc+bcc). to 비면 클라 차단(기존 fail-closed 유지). cc/bcc는 빈 배열이어도 payload에 포함.
- **Don't 클라에서 cc/bcc 교차 제외·dedup을 구현하지 마라.** Reason: D10 — 정규화는 서버(lib) 단일 소유. 클라는 쉼표 파싱만.
- **Don't 이름 힌트를 위해 주소록 API를 모달에서 호출하지 마라.** Reason: D8 — 서버가 enrich한 name만 사용(주소록 전체 미노출).
- **Don't 상세 이력에서 bcc가 undefined일 때 "숨은참조 없음"류 표시를 하지 마라.** Reason: D14 — 필드 부재는 "권한 없음" 신호. 있는 필드만 렌더.

## TDD Steps

### 1. send-modal — 실패 테스트 먼저

`tests/app/workflows/send-modal.test.tsx`에서 `effectiveRecipients` prop을 새 형태로 바꾼다. 헬퍼를 상단(SCHEDULED 상수 다음)에 추가:

```ts
const er = (to: Array<{ email: string; name?: string }>, cc: Array<{ email: string; name?: string }> = [], bcc: Array<{ email: string; name?: string }> = []) => ({ to, cc, bcc });
```

기존 케이스의 prop을 기계적으로 치환한다:
- `effectiveRecipients={["a@x.com", "b@x.com"]}` → `effectiveRecipients={er([{ email: "a@x.com" }, { email: "b@x.com" }])}`
- `effectiveRecipients={["a@x.com"]}` → `effectiveRecipients={er([{ email: "a@x.com" }])}`
- `effectiveRecipients={[]}` → `effectiveRecipients={undefined}`

기존 "② 제출 시 recipients가 화면 목록과 정확히 일치" 케이스의 payload 단언에 추가:

```ts
    expect(payload.cc).toEqual([]);   // cc/bcc도 항상 명시(D6)
    expect(payload.bcc).toEqual([]);
```

describe("SendModal prefill") 안에 추가:

```ts
  it("3필드 prefill: cc/bcc + 이름 힌트(enrich name만 표시)", () => {
    render(
      <SendModal
        taskId="t1" step={1} scheduledAt={SCHEDULED}
        effectiveRecipients={er([{ email: "a@x.com", name: "홍길동" }], [{ email: "c@x.com" }], [{ email: "b@x.com", name: "감사팀" }])}
        onClose={() => {}}
      />,
    );
    expect((screen.getByLabelText("수신자") as HTMLInputElement).value).toBe("a@x.com");
    expect((screen.getByLabelText("참조") as HTMLInputElement).value).toBe("c@x.com");
    expect((screen.getByLabelText("숨은참조") as HTMLInputElement).value).toBe("b@x.com");
    expect(screen.getByText(/a@x\.com = 홍길동/)).toBeTruthy();
    expect(screen.getByText(/b@x\.com = 감사팀/)).toBeTruthy();
    expect(screen.queryByText(/c@x\.com =/)).toBeNull(); // name 없는 항목은 힌트 없음
  });
```

describe("SendModal fail-closed (D6)") 안에 추가:

```ts
  it("③ cc/bcc 입력이 payload에 그대로(쉼표 파싱만, 정규화는 서버)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={er([{ email: "a@x.com" }])} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("참조"), { target: { value: "c@x.com,  d@x.com " } });
    fireEvent.change(screen.getByLabelText("숨은참조"), { target: { value: "b@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.recipients).toEqual(["a@x.com"]);
    expect(payload.cc).toEqual(["c@x.com", "d@x.com"]);
    expect(payload.bcc).toEqual(["b@x.com"]);
  });
  it("④ cc/bcc만 있고 To가 비면 차단(fetch 미발생)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SendModal taskId="t1" step={1} scheduledAt={SCHEDULED} effectiveRecipients={undefined} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("참조"), { target: { value: "c@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/수신자를 1명 이상/)).toBeTruthy();
  });
```

실행: `npm test -- tests/app/workflows/send-modal.test.tsx` → **FAIL**.

### 2. send-modal 구현 — `src/app/(app)/workflows/[id]/send-modal.tsx`

import에 타입 추가:

```ts
import type { EffectiveRecipientFields, RecipientEntry } from "@/modules/workflows/recipients";
```

`SendModal`·`SendForm`의 prop 타입에서 `effectiveRecipients?: string[]`를 `effectiveRecipients?: EffectiveRecipientFields`로 바꾼다(전달부는 그대로 pass-through).

`SendForm` 본문 — 상태·헬퍼(기존 `recipients` state 대체):

```ts
  const parseList = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
  const joinEmails = (list: RecipientEntry[] | undefined) => (list ?? []).map((e) => e.email).join(", ");
  const [recipients, setRecipients] = useState(joinEmails(effectiveRecipients?.to));
  const [cc, setCc] = useState(joinEmails(effectiveRecipients?.cc));
  const [bcc, setBcc] = useState(joinEmails(effectiveRecipients?.bcc));
```

`submit`의 payload를 교체(D6 — 3필드 모두 항상 명시):

```ts
    const to = parseList(recipients);
    if (to.length === 0) { setError("수신자를 1명 이상 입력하세요."); return; }
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/workflows/${taskId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 화면 3필드를 항상 명시 포함(정확히 일치, 생략 없음 — D6). 정규화(dedup·교차 제외)는 서버 lib 소유(D10).
        body: JSON.stringify({ step, subject, body: plainToHtml(body), recipients: to, cc: parseList(cc), bcc: parseList(bcc) }),
      });
```

수신자 입력 UI를 3필드 + 이름 힌트로 교체(기존 수신자 label 블록 자리):

```tsx
        <RecipientField label="수신자" value={recipients} onChange={setRecipients} entries={effectiveRecipients?.to} />
        <RecipientField label="참조" value={cc} onChange={setCc} entries={effectiveRecipients?.cc} />
        <RecipientField label="숨은참조" value={bcc} onChange={setBcc} entries={effectiveRecipients?.bcc} />
```

파일 하단에 필드 컴포넌트 추가:

```tsx
function RecipientField({ label, value, onChange, entries }: {
  label: string; value: string; onChange: (v: string) => void; entries?: RecipientEntry[];
}) {
  // 이름 힌트(D8): 서버가 enrich한 name 있는 항목만 "email = name"으로 표시.
  const hints = (entries ?? []).filter((e): e is Required<RecipientEntry> => Boolean(e.name));
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label} (쉼표 구분)</span>
      <Input aria-label={label} value={value} placeholder="name@example.com, ..." onChange={(e) => onChange(e.target.value)} />
      {hints.length > 0 && (
        <span className="text-xs text-muted-foreground">{hints.map((e) => `${e.email} = ${e.name}`).join(" · ")}</span>
      )}
    </label>
  );
}
```

실행: `npm test -- tests/app/workflows/send-modal.test.tsx` → **PASS**.

### 3. workflow-detail — 실패 테스트 먼저

`tests/app/workflows/workflow-detail.test.tsx`에 describe 추가:

```tsx
describe("메일 이력 cc/bcc 표시 + 모달 prefill 전달", () => {
  const mail = (over: Record<string, unknown> = {}) => ({
    id: "m1", step: "1", recipients: ["a@x.com"], cc: [], subject: "s", status: "SENT", errorMessage: null, sentAt: null, ...over,
  });

  it("cc/bcc 있으면 라벨과 함께 표시", () => {
    detailData.current = baseDetail({ mailDeliveries: [mail({ cc: ["c@x.com"], bcc: ["b@x.com"] })] });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.getByText(/참조: c@x\.com/)).toBeTruthy();
    expect(screen.getByText(/숨은참조: b@x\.com/)).toBeTruthy();
  });

  it("bcc 필드 부재(view-only 응답, D14) → 숨은참조 미표시", () => {
    detailData.current = baseDetail({ mailDeliveries: [mail({ cc: ["c@x.com"] })] });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    expect(screen.queryByText(/숨은참조/)).toBeNull();
  });

  it("발송 모달에 자기 step의 effectiveRecipients를 전달", () => {
    can.send = true;
    detailData.current = baseDetail({
      status: "GENERATED",
      effectiveRecipients: {
        "1": { to: [{ email: "a@x.com", name: "홍" }], cc: [], bcc: [] },
        "2": { to: [{ email: "z@x.com" }], cc: [], bcc: [] },
      },
    });
    render(<WorkflowDetail taskId="t1" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "1단계 발송" }));
    expect(screen.getByTestId("send-modal").textContent).toContain("to a@x.com");
  });
});
```

SendModal mock(파일 상단)을 prefill 검증 가능하게 교체:

```tsx
vi.mock("@/app/(app)/workflows/[id]/send-modal", () => ({
  SendModal: (p: { step: number; effectiveRecipients?: { to: Array<{ email: string }> } }) => (
    <div data-testid="send-modal">step {p.step} to {(p.effectiveRecipients?.to ?? []).map((e) => e.email).join(",")}</div>
  ),
}));
```

추가로, **기존 케이스의 mailDeliveries fixture**(재시도·resolve 버튼 테스트 등)에 `cc: []`를 보강한다 — 컴포넌트가 `m.cc.length`를 읽으므로 누락 시 기존 케이스가 TypeError로 깨진다.

실행: `npm test -- tests/app/workflows/workflow-detail.test.tsx` → **FAIL**.

### 4. workflow-detail 구현 — `src/app/(app)/workflows/[id]/workflow-detail.tsx`

import에 타입 추가:

```ts
import type { EffectiveRecipientsMap } from "@/modules/workflows/recipients";
```

로컬 interface 갱신:

```ts
interface MailView { id: string; step: string | null; recipients: string[]; cc: string[]; bcc?: string[]; subject: string; status: MailStatus; errorMessage: string | null; sentAt: string | null; }
interface Detail {
  id: string; kind: string; typeName: string; scheduledAt: string; status: WfStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
  effectiveRecipients?: EffectiveRecipientsMap; // :send 권한자에게만 백엔드가 포함(D8 — 단계별 맵)
}
```

메일 이력 항목 렌더(기존 `<span className="text-muted-foreground">{m.recipients.join(", ")}</span>` 자리)를 교체:

```tsx
                <span className="text-muted-foreground">{m.recipients.join(", ")}</span>
                {m.cc.length > 0 && <span className="text-muted-foreground">참조: {m.cc.join(", ")}</span>}
                {m.bcc && m.bcc.length > 0 && <span className="text-muted-foreground">숨은참조: {m.bcc.join(", ")}</span>}
```

`cc`가 undefined인 구버전 응답 방어는 불필요(서버 배포 단위 동일) — 단, `m.cc.length` 접근 전 안전을 위해 fetch 매핑은 그대로 두고 interface만 신뢰한다.

SendModal 전달부를 교체:

```tsx
        <SendModal
          taskId={taskId}
          step={sendStep}
          scheduledAt={detail.scheduledAt}
          effectiveRecipients={detail.effectiveRecipients?.[String(sendStep)]}
          onClose={() => setSendStep(null)}
        />
```

실행: `npm test -- tests/app/workflows/workflow-detail.test.tsx` → **PASS**.

### 5. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/app/workflows
```

기존 workflow-detail·send-modal 케이스 전체 green(치환 누락 없음) 확인. 전부 green이면 위 Files만 stage해 커밋.

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` → 통과(task-07과 합쳐 effectiveRecipients 타입 일관).
- `npm test -- tests/app/workflows` → 통과.
- 모달: 3필드 prefill(자기 step), payload 항상 명시(recipients+cc+bcc), to 빈 차단, 이름 힌트는 name 있는 항목만.
- 상세 이력: cc 비면 미표시, bcc는 필드 존재+비어있지 않을 때만 표시.
