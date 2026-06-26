# Task 06 — 설정 편집기: String / Number / List 분기(D8)

**Purpose**: `SettingEditor`가 `initialValue` 타입으로 편집기를 선택하도록 한다 — `number`→숫자 입력, `string`→텍스트 입력, `string[]`→리스트 편집기(행 추가/삭제·Enter·이메일 검증), `boolean`→기존 스위치, 객체→기존 JSON textarea 폴백. 모두 기존 `putSetting` 판별 유니온·토큰 동시성 패턴을 재사용한다.

## Files

- Modify `src/app/(app)/admin/settings/settings-editor.tsx`
- Modify `tests/app/admin/settings-editor.test.tsx`

## Prep

- spec §5.4. `Button`(`@/components/ui/button`)은 `default|outline|secondary|ghost|destructive|link` variant 보유, native button props(aria-label 등) 지원. `Input`(`@/components/ui/input`)은 native input props.
- Deps: 없음(순수 UI). 단 `integrations.smtp.host`를 string으로 렌더하던 기존 테스트는 이 task가 갱신(host는 task-01에서 카탈로그 제거됨).
- **NumberSettingEditor 비고(P3/A2):** port가 env 전용이 되어 현재 numeric systemSetting은 없다. `NumberSettingEditor`와 `typeof === "number"` 분기는 **D8의 타입-완전 dispatch**(boolean/number/string/array/object 전체를 다룸)의 일부로 **유지**한다 — 한 arm만 빼면 향후 numeric 설정이 JSON textarea로 새므로. 테스트는 합성 키(`demo.number.value`)로 컴포넌트 분기만 검증한다(`SettingEditor`는 값 타입으로 분기, 카탈로그 미참조).

## TDD steps

### Step 1 — 타입 분기 테스트 갱신/추가(FAIL 유도)

`tests/app/admin/settings-editor.test.tsx`:

(a) 상단 import에 `toast` 추가(이메일 거부 검증용):
```ts
import { toast } from "sonner";
```

(b) 기존 "비boolean initialValue → textarea 경로 유지" 테스트(파일 마지막 it)를 **삭제**하고, 아래 describe 블록을 파일 끝에 추가:
```tsx
describe("SettingEditor — 타입 분기(D8)", () => {
  it("string initialValue → text input(textarea/switch 아님)", () => {
    render(<SettingEditor settingKey="integrations.smtp.fromAddress" initialValue={"ops@x.com"} updatedAt={null} />);
    expect(document.querySelector("input")).toBeTruthy();
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("number initialValue → number input(spinbutton, 초기값 표시)", () => {
    render(<SettingEditor settingKey="demo.number.value" initialValue={587} updatedAt={null} />);
    const spin = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(spin.value).toBe("587");
  });

  it("object initialValue → 기존 JSON textarea 폴백", () => {
    render(<SettingEditor settingKey="workflows.billing.config" initialValue={{ year: 2026 }} updatedAt={null} />);
    expect(document.querySelector("textarea")).toBeTruthy();
  });

  it("string 편집기 저장 → PUT(value:string·token), ok 시 토큰 갱신", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "2026-06-26T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="integrations.smtp.fromAddress" initialValue={"ops@x.com"} updatedAt="2026-06-25T00:00:00.000Z" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/settings/integrations.smtp.fromAddress");
    const body = JSON.parse(init.body as string);
    expect(body.value).toBe("new@x.com");
    expect(body.expectedUpdatedAt).toBe("2026-06-25T00:00:00.000Z");
  });

  it("number 편집기 저장 → PUT(value:number, 문자열 아님)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "2026-06-26T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="demo.number.value" initialValue={587} updatedAt={null} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "465" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).value).toBe(465);
  });

  it("list 편집기: 행 추가 후 저장 → PUT(value: 전체 배열)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="integrations.google.calendarIds" initialValue={["cal-1"]} updatedAt={null} />);
    fireEvent.change(screen.getByPlaceholderText("추가할 항목 입력"), { target: { value: "cal-2" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).value).toEqual(["cal-1", "cal-2"]);
  });

  it("list 편집기: 삭제(✕) 후 저장 → 해당 항목 빠진 배열", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="integrations.google.calendarIds" initialValue={["cal-1", "cal-2"]} updatedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "cal-1 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).value).toEqual(["cal-2"]);
  });

  it("list 편집기(이메일 키): 잘못된 형식 추가 거부(toast.error, 미추가)", () => {
    vi.mocked(toast.error).mockClear();
    render(<SettingEditor settingKey="workflows.weeklyReport.defaultRecipients" initialValue={[]} updatedAt={null} />);
    fireEvent.change(screen.getByPlaceholderText("추가할 항목 입력"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText("not-an-email")).toBeNull();
  });
});
```

실행: `npm test -- tests/app/admin/settings-editor.test.tsx` → **FAIL**(신규 편집기 미구현; string이 아직 textarea로 감).

### Step 2 — settings-editor.tsx 전체 교체

`src/app/(app)/admin/settings/settings-editor.tsx`를 아래 전체 내용으로 교체한다. **`putSetting`·`BooleanSettingEditor`·`JsonSettingEditor`는 기존 그대로**(회귀 없음), `SettingEditor` 분기 확장 + `StringSettingEditor`/`NumberSettingEditor`/`ListSettingEditor` 신설:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type EditorProps = {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null; // ISO 또는 null(아직 override 없음)
};

export function SettingEditor(props: EditorProps) {
  const v = props.initialValue;
  // 값 타입으로 편집기 선택(D8). 서버 zod가 여전히 권위 검증.
  // Array.isArray는 typeof object보다 먼저(배열도 object이므로) — JSON 폴백은 객체 전용.
  if (typeof v === "boolean") {
    return <BooleanSettingEditor settingKey={props.settingKey} initialValue={v} updatedAt={props.updatedAt} />;
  }
  if (typeof v === "number") {
    return <NumberSettingEditor settingKey={props.settingKey} initialValue={v} updatedAt={props.updatedAt} />;
  }
  if (Array.isArray(v)) {
    return <ListSettingEditor settingKey={props.settingKey} initialValue={v as string[]} updatedAt={props.updatedAt} />;
  }
  if (typeof v === "string") {
    return <StringSettingEditor settingKey={props.settingKey} initialValue={v} updatedAt={props.updatedAt} />;
  }
  return <JsonSettingEditor {...props} />;
}

// PUT 공통 결과(판별 유니온): **절대 throw하지 않는다.**
//  - ok       : 서버가 새 토큰을 확정 반환 → 성공.
//  - rejected : 서버가 값 자체를 거부했고 행은 그대로(422/그 외 !ok). 로컬 prev가 여전히 권위값 → 안전 롤백.
//  - refetch  : 로컬 상태가 권위가 아님 → 권위 상태를 재조회해야 한다. 두 경우:
//      (1) 409 충돌 — 다른 사용자가 행을 바꿈 → 낙관값 next도, 롤백 대상 prev도 stale(둘 다 거짓).
//      (2) 응답 미수신(fetch 거부)·2xx 본문 파싱 실패 — 반영 여부 불명.
//   putSetting이 모든 사용자 토스트를 전담한다(콜러는 상태 전이만).
type PutResult = { kind: "ok"; token: string } | { kind: "rejected" } | { kind: "refetch" };

async function putSetting(
  settingKey: string,
  value: unknown,
  token: string | null,
): Promise<PutResult> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/settings/${encodeURIComponent(settingKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, expectedUpdatedAt: token }),
    });
  } catch {
    toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 409) {
    toast.error("다른 사용자가 먼저 변경했습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 422) {
    toast.error("검증 실패: 값 형식을 확인하세요.");
    return { kind: "rejected" };
  }
  if (!res.ok) {
    toast.error("저장에 실패했습니다.");
    return { kind: "rejected" };
  }
  try {
    const body = (await res.json()) as { updatedAt?: unknown };
    if (typeof body.updatedAt !== "string") {
      toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
      return { kind: "refetch" };
    }
    toast.success("저장되었습니다.");
    return { kind: "ok", token: body.updatedAt };
  } catch {
    toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
}

function BooleanSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: boolean;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(initialValue);
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 토글 상태를 props 변경과 동기화하기 위한 의도된 패턴
    setChecked(initialValue);
    setToken(updatedAt);
  }, [initialValue, updatedAt]);

  async function toggle(next: boolean) {
    const prev = checked;
    setChecked(next);
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, next, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") {
      setToken(result.token);
      return;
    }
    if (result.kind === "rejected") {
      setChecked(prev);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={toggle} disabled={saving} label={settingKey} />
      <span className="text-sm text-muted-foreground">{checked ? "켜짐" : "꺼짐"}</span>
    </div>
  );
}

function StringSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: string;
  updatedAt: string | null;
}) {
  const [text, setText] = useState(initialValue);
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, text, token);
    } finally {
      setSaving(false);
    }
    // ok면 토큰 갱신. rejected/refetch는 putSetting이 토스트를 띄우고, 입력 보존 위해 refresh 안 함.
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="flex items-center gap-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} className="max-w-md" />
      <Button type="button" size="sm" onClick={save} disabled={saving}>
        {saving ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}

function NumberSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: number;
  updatedAt: string | null;
}) {
  const [text, setText] = useState(String(initialValue));
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) {
      toast.error("형식 오류: 숫자를 입력하세요.");
      return;
    }
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, n, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="flex items-center gap-2">
      <Input type="number" value={text} onChange={(e) => setText(e.target.value)} className="max-w-[12rem]" />
      <Button type="button" size="sm" onClick={save} disabled={saving}>
        {saving ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ListSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: string[];
  updatedAt: string | null;
}) {
  // 이메일 리스트만 클라 형식 검증(나머지는 비어있지 않음+중복만). 서버 zod가 권위.
  const requireEmail = settingKey === "workflows.weeklyReport.defaultRecipients";
  const [items, setItems] = useState<string[]>(initialValue);
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  function addItem() {
    const v = draft.trim();
    if (!v) return;
    if (requireEmail && !EMAIL_RE.test(v)) {
      toast.error("이메일 형식이 아닙니다.");
      return;
    }
    if (items.includes(v)) {
      toast.error("이미 추가된 항목입니다.");
      return;
    }
    setItems([...items, v]);
    setDraft("");
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, items, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="grid gap-2">
      {items.length > 0 ? (
        <ul className="grid gap-1">
          {items.map((it, idx) => (
            <li key={`${it}-${idx}`} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{it}</span>
              <Button type="button" size="sm" variant="ghost" aria-label={`${it} 삭제`} onClick={() => removeItem(idx)}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-muted-foreground">항목 없음</div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder="추가할 항목 입력"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          className="max-w-md"
        />
        <Button type="button" size="sm" variant="secondary" onClick={addItem}>
          추가
        </Button>
      </div>
      <div>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}

function JsonSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null;
}) {
  const [text, setText] = useState(() => JSON.stringify(initialValue, null, 2));
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast.error("형식 오류: 올바른 JSON이 아닙니다.");
      return;
    }
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, parsed, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="grid gap-1.5">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="font-mono" />
      <div>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}
```

실행: `npm test -- tests/app/admin/settings-editor.test.tsx` → **PASS**(boolean 기존 5 + 타입 분기 8).

## Acceptance Criteria

```bash
npm test -- tests/app/admin/settings-editor.test.tsx   # PASS (boolean 회귀 + 신규 분기)
npm run typecheck                                       # 0 errors
npm run lint                                            # 0 errors
```

## Cautions

- **Don't `Array.isArray` 분기를 `typeof === "object"` 뒤에 두지 마라.** Reason: 배열도 `typeof === "object"`라 순서가 틀리면 list가 JSON textarea로 샌다. boolean→number→Array→string→object(JSON) 순.
- **Don't number 편집기에서 value를 문자열로 PUT하지 마라.** Reason: 서버 zod는 `z.coerce.number()`라 통과하긴 하나, 클라가 의미상 number를 보내야 일관. `Number(text)` 변환 후 전송.
- **Don't list/string/number 편집기에서 rejected/refetch 시 `router.refresh()`를 호출하지 마라.** Reason: 사용자가 입력 중인 값을 날린다. boolean만 낙관적 토글이라 refresh로 권위 재동기화. 입력형 편집기는 JSON 경로와 동일하게 입력 보존.
- **Don't `env` secret 항목에 편집기를 붙이지 마라.** Reason: secret은 상태 배지 + "env" 태그만(편집 불가). 페이지(task-07)가 envSecret/relational은 편집기 없이 렌더한다 — SettingEditor는 systemSetting에만 호출된다.
