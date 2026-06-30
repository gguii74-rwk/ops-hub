# Task 04 — 대금청구 설정 페이지 (계약정보 + 회차표)

`/workflows/billing/settings`: 연도별 `BillingConfig` CRUD + 1~12회차 제출일 관리. 읽기=`:view`(페이지 가드), 쓰기 컨트롤=`:configure`.

## Files

- Create: `src/app/(app)/workflows/billing/settings/config-form.ts` (순수 검증·페이로드)
- Create: `src/app/(app)/workflows/billing/settings/page.tsx` (서버 셸 + 권한 가드)
- Create: `src/app/(app)/workflows/billing/settings/billing-settings.tsx` (client)
- Create (test): `tests/app/workflows/config-form.test.ts`
- Create (test): `tests/app/workflows/billing-settings.test.tsx`

## Prep

- 엔트리포인트 §SC-1(config API)·§SC-6(DTO)·§SC-7(round-date 변환)·§SC-9(권한)·§SC-11(관례) 숙지.
- `dateInputToSubmitDateIso`/`submitDateIsoToDateInput`는 task-03(`./round-date`)에서 옴.
- `GET config`는 **전체 필드 DTO 목록**을 반환(`findAllBillingConfig`) → 선택 연도 config를 목록에서 파생(별도 GET 불필요). 회차만 `GET .../rounds`.

## Deps

task-03 (round-date 변환).

## TDD steps

### Step 1 — config-form 검증 테스트 (RED)

`tests/app/workflows/config-form.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateConfigForm, formToConfigPayload, emptyConfigForm, MAX_MONTHLY } from "@/app/(app)/workflows/billing/settings/config-form";

const base = { ...emptyConfigForm, year: 2026, projectName: "P", contractNumber: "C-1",
  contractAmount: "1200", monthlyAmount: "100", contractAmountKor: "천이백", monthlyAmountKor: "백" };

describe("validateConfigForm", () => {
  it("정상 입력 → null", () => { expect(validateConfigForm(base)).toBeNull(); });
  it("사업명 누락 → 오류", () => { expect(validateConfigForm({ ...base, projectName: "  " })).toMatch(/사업명/); });
  it("금액 0/음수/소수 → 오류", () => {
    expect(validateConfigForm({ ...base, contractAmount: "0" })).toMatch(/총 계약금액/);
    expect(validateConfigForm({ ...base, monthlyAmount: "-5" })).toMatch(/월 청구금액/);
    expect(validateConfigForm({ ...base, contractAmount: "12.5" })).toMatch(/총 계약금액/);
  });
  it("월 청구액 상한(MAX_SAFE/12) 초과 → 오류", () => {
    expect(validateConfigForm({ ...base, monthlyAmount: String(MAX_MONTHLY + 1) })).toMatch(/월 청구금액/);
  });
  it("한글 금액 누락 → 오류", () => { expect(validateConfigForm({ ...base, contractAmountKor: "" })).toMatch(/한글/); });
});

describe("formToConfigPayload", () => {
  it("금액은 Number, 문자열은 trim", () => {
    expect(formToConfigPayload({ ...base, projectName: " P " })).toEqual({
      year: 2026, projectName: "P", contractNumber: "C-1",
      contractAmount: 1200, monthlyAmount: 100, contractAmountKor: "천이백", monthlyAmountKor: "백",
    });
  });
});
```

Run: `npm test -- tests/app/workflows/config-form.test.ts` → **FAIL**(파일 없음).

### Step 2 — config-form.ts 구현

`src/app/(app)/workflows/billing/settings/config-form.ts`:

```ts
export interface ConfigForm {
  year: number;
  projectName: string;
  contractNumber: string;
  contractAmount: string; // raw input
  monthlyAmount: string;
  contractAmountKor: string;
  monthlyAmountKor: string;
}

export const emptyConfigForm: ConfigForm = {
  year: 0, projectName: "", contractNumber: "",
  contractAmount: "", monthlyAmount: "", contractAmountKor: "", monthlyAmountKor: "",
};

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
export const MAX_MONTHLY = Math.floor(MAX_SAFE / 12); // J4: 12회차 누계도 안전정수 내

// 클라 안내용 검증(서버 zod가 권위). 첫 오류 메시지 또는 null.
export function validateConfigForm(f: ConfigForm): string | null {
  if (!f.projectName.trim()) return "사업명을 입력하세요.";
  if (!f.contractNumber.trim()) return "계약번호를 입력하세요.";
  if (!f.contractAmountKor.trim() || !f.monthlyAmountKor.trim()) return "금액(한글)을 입력하세요.";
  const c = Number(f.contractAmount);
  const m = Number(f.monthlyAmount);
  if (!Number.isInteger(c) || c <= 0 || c > MAX_SAFE) return "총 계약금액은 양의 정수(상한 내)여야 합니다.";
  if (!Number.isInteger(m) || m <= 0 || m > MAX_MONTHLY) return "월 청구금액은 양의 정수(상한 내)여야 합니다.";
  return null;
}

export function formToConfigPayload(f: ConfigForm) {
  return {
    year: f.year,
    projectName: f.projectName.trim(),
    contractNumber: f.contractNumber.trim(),
    contractAmount: Number(f.contractAmount),
    monthlyAmount: Number(f.monthlyAmount),
    contractAmountKor: f.contractAmountKor.trim(),
    monthlyAmountKor: f.monthlyAmountKor.trim(),
  };
}
```

Run: `npm test -- tests/app/workflows/config-form.test.ts` → **PASS**.

### Step 3 — 서버 셸 page.tsx

`src/app/(app)/workflows/billing/settings/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { PageSection } from "@/components/ui/page-section";
import { BillingSettings } from "./billing-settings";

export default async function BillingSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "workflows.billing", "view"))) redirect("/workflows");
  const canConfigure = await hasPermission(session.user.id, "workflows.billing", "configure");
  return (
    <PageSection title="대금청구 설정" subtitle="연도별 계약 정보와 회차 제출일을 관리합니다.">
      <BillingSettings canConfigure={canConfigure} />
    </PageSection>
  );
}
```

### Step 4 — billing-settings.tsx (client)

`src/app/(app)/workflows/billing/settings/billing-settings.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { validateConfigForm, formToConfigPayload, emptyConfigForm, type ConfigForm } from "./config-form";
import { dateInputToSubmitDateIso, submitDateIsoToDateInput } from "./round-date";

interface ConfigDto {
  id: string; year: number; projectName: string; contractNumber: string;
  contractAmount: number; monthlyAmount: number; contractAmountKor: string; monthlyAmountKor: string;
  createdAt: string; updatedAt: string;
}
interface RoundDto { round: number; submitDate: string }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

export function BillingSettings({ canConfigure }: { canConfigure: boolean }) {
  const list = useQuery({ queryKey: ["billing-config"], queryFn: () => getJson<ConfigDto[]>("/api/workflows/billing/config") });
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [newYear, setNewYear] = useState("");

  if (list.isLoading) return <LoadingState />;
  if (list.isError) return <ErrorState message="설정을 불러오지 못했습니다." />;

  const configs = list.data ?? [];
  const years = configs.map((c) => c.year);
  const selectedConfig = configs.find((c) => c.year === selectedYear) ?? null;

  function addYear() {
    const y = Number(newYear);
    if (!Number.isInteger(y) || y < 2020 || y > 2100) { toast.error("연도는 2020~2100 정수입니다."); return; }
    if (years.includes(y)) { toast.error("이미 존재하는 연도입니다."); }
    setSelectedYear(y);
    setNewYear("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">연도</span>
          <Select
            aria-label="연도 선택"
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
            className="w-40"
          >
            <option value="">연도 선택</option>
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </Select>
        </label>
        {canConfigure && (
          <div className="flex items-end gap-1">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">새 연도</span>
              <Input type="number" aria-label="새 연도" value={newYear} placeholder="2026" className="w-28" onChange={(e) => setNewYear(e.target.value)} />
            </label>
            <Button size="sm" variant="secondary" onClick={addYear}>추가</Button>
          </div>
        )}
      </div>

      {selectedYear != null && (
        <>
          <ConfigForm key={selectedYear} year={selectedYear} config={selectedConfig} canConfigure={canConfigure} onDeleted={() => setSelectedYear(null)} />
          <RoundsTable year={selectedYear} canConfigure={canConfigure} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}

function ConfigForm({ year, config, canConfigure, onDeleted }: { year: number; config: ConfigDto | null; canConfigure: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigForm>(
    config
      ? {
          year, projectName: config.projectName, contractNumber: config.contractNumber,
          contractAmount: String(config.contractAmount), monthlyAmount: String(config.monthlyAmount),
          contractAmountKor: config.contractAmountKor, monthlyAmountKor: config.monthlyAmountKor,
        }
      : { ...emptyConfigForm, year },
  );
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const exists = config != null;
  const set = (k: keyof ConfigForm, v: string) => setForm((s) => ({ ...s, [k]: v }));

  async function save() {
    const err = validateConfigForm(form);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const res = await fetch(exists ? `/api/workflows/billing/config/${year}` : "/api/workflows/billing/config", {
        method: exists ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToConfigPayload(form)),
      });
      if (!res.ok) { toast.error(res.status === 409 ? "이미 존재하는 연도입니다." : "저장에 실패했습니다."); return; }
      toast.success("저장되었습니다.");
      await qc.invalidateQueries({ queryKey: ["billing-config"] });
    } finally { setSaving(false); }
  }

  async function remove() {
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/billing/config/${year}`, { method: "DELETE" });
      if (!res.ok) { toast.error("삭제에 실패했습니다."); return; }
      toast.success("삭제되었습니다.");
      // 선택 해제(F-B1): ConfigForm은 key=selectedYear로 계속 mounted라 useState 초기값이 재적용되지 않는다.
      // 그대로 두면 form이 삭제 전 계약값을 유지(exists만 false) → 사용자가 저장을 누르면 방금 삭제한 연도를
      // stale 값으로 POST 재생성한다. 부모가 selectedYear=null로 폼을 unmount → 다음 선택/생성 시 깨끗한 상태.
      onDeleted();
      await qc.invalidateQueries({ queryKey: ["billing-config"] });
    } finally { setSaving(false); setConfirmingDelete(false); }
  }

  return (
    <section className="grid gap-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">{year}년 계약 정보</h2>
      <Field label="사업명"><Input value={form.projectName} disabled={!canConfigure} onChange={(e) => set("projectName", e.target.value)} /></Field>
      <Field label="계약번호"><Input value={form.contractNumber} disabled={!canConfigure} onChange={(e) => set("contractNumber", e.target.value)} /></Field>
      <Field label="총 계약금액(원)"><Input type="number" value={form.contractAmount} disabled={!canConfigure} onChange={(e) => set("contractAmount", e.target.value)} /></Field>
      <Field label="총 계약금액(한글)"><Input value={form.contractAmountKor} disabled={!canConfigure} onChange={(e) => set("contractAmountKor", e.target.value)} /></Field>
      <Field label="월 청구액(원)"><Input type="number" value={form.monthlyAmount} disabled={!canConfigure} onChange={(e) => set("monthlyAmount", e.target.value)} /></Field>
      <Field label="월 청구액(한글)"><Input value={form.monthlyAmountKor} disabled={!canConfigure} onChange={(e) => set("monthlyAmountKor", e.target.value)} /></Field>
      {canConfigure && (
        <div className="grid gap-2">
          <div className="flex gap-2">
            <Button size="sm" aria-label="계약 정보 저장" disabled={saving} onClick={save}>{saving ? "저장 중…" : "저장"}</Button>
            {exists && !confirmingDelete && (
              <Button size="sm" variant="destructive" aria-label="계약 정보 삭제" disabled={saving} onClick={() => setConfirmingDelete(true)}>삭제</Button>
            )}
          </div>
          {exists && confirmingDelete && (
            // 파괴적 삭제(연도 설정 + 회차 제출일 연쇄 삭제, SC-1)는 확인 후에만 실행(F-A3).
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
              <span>{year}년 계약 정보와 등록된 회차 제출일이 모두 삭제됩니다. 계속하시겠습니까?</span>
              <Button size="sm" variant="destructive" aria-label="삭제 확정" disabled={saving} onClick={remove}>삭제 확정</Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setConfirmingDelete(false)}>취소</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RoundsTable({ year, canConfigure }: { year: number; canConfigure: boolean }) {
  const qc = useQueryClient();
  const rounds = useQuery({ queryKey: ["billing-rounds", year], queryFn: () => getJson<RoundDto[]>(`/api/workflows/billing/config/${year}/rounds`) });
  const [busy, setBusy] = useState<number | null>(null);

  async function saveRound(round: number, dateStr: string) {
    if (!dateStr) { toast.error("제출일을 입력하세요."); return; }
    setBusy(round);
    try {
      const res = await fetch(`/api/workflows/billing/config/${year}/rounds/${round}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submitDate: dateInputToSubmitDateIso(dateStr) }),
      });
      if (!res.ok) { toast.error("회차 저장에 실패했습니다."); return; }
      toast.success(`${round}회차 저장`);
      await qc.invalidateQueries({ queryKey: ["billing-rounds", year] });
    } finally { setBusy(null); }
  }
  async function deleteRound(round: number) {
    setBusy(round);
    try {
      const res = await fetch(`/api/workflows/billing/config/${year}/rounds/${round}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) { toast.error("회차 삭제에 실패했습니다."); return; }
      toast.success(`${round}회차 삭제`);
      await qc.invalidateQueries({ queryKey: ["billing-rounds", year] });
    } finally { setBusy(null); }
  }

  if (rounds.isLoading) return <LoadingState />;
  const byRound = new Map((rounds.data ?? []).map((r) => [r.round, r.submitDate]));

  return (
    <section className="grid gap-2">
      <h2 className="font-medium">회차 제출일</h2>
      <Table>
        <TableHeader>
          <TableRow><TableHead>회차</TableHead><TableHead>월분</TableHead><TableHead>제출일</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((round) => {
            const initial = byRound.get(round) ?? null;
            return (
              <RoundRow
                key={`${round}-${initial ?? ""}`}
                round={round}
                initial={initial}
                canConfigure={canConfigure}
                busy={busy === round}
                onSave={(d) => saveRound(round, d)}
                onDelete={() => deleteRound(round)}
              />
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function RoundRow({
  round, initial, canConfigure, busy, onSave, onDelete,
}: {
  round: number; initial: string | null; canConfigure: boolean; busy: boolean;
  onSave: (d: string) => void; onDelete: () => void;
}) {
  const [date, setDate] = useState(initial ? submitDateIsoToDateInput(initial) : "");
  return (
    <TableRow>
      <TableCell>{round}회차</TableCell>
      <TableCell>{round}월분</TableCell>
      <TableCell>
        <Input type="date" aria-label={`${round}회차 제출일`} value={date} disabled={!canConfigure} className="w-40" onChange={(e) => setDate(e.target.value)} />
      </TableCell>
      <TableCell>
        {canConfigure && (
          <span className="flex gap-1">
            <Button size="sm" variant="outline" aria-label={`${round}회차 저장`} disabled={busy} onClick={() => onSave(date)}>저장</Button>
            {initial && <Button size="sm" variant="ghost" aria-label={`${round}회차 삭제`} disabled={busy} onClick={onDelete}>삭제</Button>}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
```

### Step 5 — 컴포넌트 테스트 (권한 게이트·금액 차단·회차 PUT 변환)

`tests/app/workflows/billing-settings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn());
const data = vi.hoisted(() => ({ list: [] as unknown[], rounds: [] as unknown[] }));
const toastErr = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "billing-rounds" ? data.rounds : data.list,
    isLoading: false, isError: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: toastErr, success: vi.fn() } }));

import { BillingSettings } from "@/app/(app)/workflows/billing/settings/billing-settings";
import { dateInputToSubmitDateIso } from "@/app/(app)/workflows/billing/settings/round-date";

const cfg = {
  id: "c1", year: 2026, projectName: "P", contractNumber: "C-1",
  contractAmount: 1200, monthlyAmount: 100, contractAmountKor: "천이백", monthlyAmountKor: "백",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => { data.list = [cfg]; data.rounds = []; invalidate.mockClear(); toastErr.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function selectYear(y: string) {
  fireEvent.change(screen.getByLabelText("연도 선택"), { target: { value: y } });
}

describe("BillingSettings 권한 게이트", () => {
  it("canConfigure=false면 저장/삭제·회차 저장 버튼 미노출(read-only)", () => {
    render(<BillingSettings canConfigure={false} />);
    selectYear("2026");
    expect(screen.queryByLabelText("계약 정보 저장")).toBeNull();
    expect(screen.queryByLabelText("계약 정보 삭제")).toBeNull();
    expect(screen.queryByLabelText("1회차 저장")).toBeNull();
  });
});

describe("계약 정보 저장 검증", () => {
  it("금액이 0이면 toast 오류 + fetch 미호출", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    fireEvent.change(screen.getByLabelText("총 계약금액(원)"), { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText("계약 정보 저장"));
    expect(toastErr).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("회차 저장", () => {
  it("date 입력 → PUT submitDate가 KST→UTC ISO로 변환(D11)", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    fireEvent.change(screen.getByLabelText("1회차 제출일"), { target: { value: "2026-02-10" } });
    fireEvent.click(screen.getByLabelText("1회차 저장"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/billing/config/2026/rounds/1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ submitDate: dateInputToSubmitDateIso("2026-02-10") });
  });
});

describe("계약 정보 삭제 확인(F-A3)", () => {
  it("삭제 클릭만으로는 DELETE 미호출 — 확인 후에만 실행(회차 연쇄 손실 방지)", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    fireEvent.click(screen.getByLabelText("계약 정보 삭제"));
    expect(fetchMock).not.toHaveBeenCalled(); // 확인 단계만 노출, 아직 삭제 안 함
    fireEvent.click(screen.getByLabelText("삭제 확정"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/billing/config/2026");
    expect(init.method).toBe("DELETE");
  });

  it("삭제 확정 후 선택 해제 — 폼 unmount(stale 값 재생성 차단, F-B1)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingSettings canConfigure />);
    selectYear("2026");
    expect(screen.getByLabelText("계약 정보 저장")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("계약 정보 삭제"));
    fireEvent.click(screen.getByLabelText("삭제 확정"));
    // onDeleted → 부모 selectedYear=null → ConfigForm/RoundsTable unmount(저장 버튼 사라짐). stale form 유지 안 함.
    await waitFor(() => expect(screen.queryByLabelText("계약 정보 저장")).toBeNull());
  });
});
```

Run: `npm test -- tests/app/workflows/billing-settings.test.tsx` → **PASS**.

## Acceptance Criteria

- `npm test -- tests/app/workflows/config-form.test.ts tests/app/workflows/billing-settings.test.tsx` → PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 위반 없음.
- 전체 `npm test`·`npm run build` → green.

## Cautions

- **Don't** date input을 그대로 PUT하지 말 것 — `dateInputToSubmitDateIso`로 변환(D11).
- **Don't** `:configure` 없는 사용자에게 저장/삭제 컨트롤을 렌더하지 말 것. 페이지 진입은 `:view`(서버 가드), 쓰기 컨트롤은 `canConfigure` prop으로 게이트(서버 API도 fail-closed).
- 선택 연도 config는 `GET config` 목록에서 파생한다(별도 `GET config/[year]` 불필요). 회차만 `GET .../rounds`.
- **Don't** 삭제를 확인 없이 즉시 실행하지 말 것(F-A3) — `DELETE config/[year]`는 회차 제출일까지 연쇄 삭제하는 비가역 계약(SC-1)이다. 삭제 클릭은 확인 단계만 띄우고, **확인(삭제 확정) 후에만** DELETE를 호출한다. 서버측 `updatedAt` 충돌 검사는 백엔드 DELETE 계약(머지済) 범위라 이 UI 슬라이스 밖(OUT_OF_SCOPE) — 필요 시 별도 백엔드 follow-up.
- **Don't** 삭제 성공 후 `selectedYear`를 그대로 두지 말 것(F-B1) — `ConfigForm`은 `key={selectedYear}`로 mounted 유지라 `useState` 초기값이 재적용되지 않는다. 삭제 후 form이 삭제 전 계약값을 유지(`exists`만 false)해, 저장 시 방금 삭제한 연도를 stale 값으로 재생성한다. `onDeleted`로 부모가 `selectedYear=null`로 폼을 unmount한다.
