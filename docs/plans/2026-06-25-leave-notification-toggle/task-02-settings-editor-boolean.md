# task-02 — 설정 에디터 boolean 분기(Switch)

`SettingEditor`가 `initialValue`가 boolean이면 raw JSON textarea 대신 **Switch 토글**을 렌더한다. 토글 변경 즉시 `PUT`(낙관적 업데이트, 실패 시 롤백). boolean 외 값은 기존 textarea 경로를 **그대로** 유지(회귀 없음).

## Files

- Modify: `src/app/(app)/admin/settings/settings-editor.tsx` — boolean 분기 + `BooleanSettingEditor` 추가, 기존 textarea 로직을 `JsonSettingEditor`로 분리.
- Test: `tests/app/admin/settings-editor.test.tsx` (신규) — boolean→Switch·토글 PUT, 비boolean→textarea.

## Prep

- 읽기: 엔트리포인트 §SC-3(PUT 계약), §SC-4(Switch 시그니처).
- 컴포넌트 테스트 패턴 참고: `tests/app/leave/request-leave-modal.test.tsx`(`@vitest-environment jsdom` + `@testing-library/react` + `vi.stubGlobal("fetch")`).
- 조건부 hook 금지 → boolean/JSON을 **별 컴포넌트로 분리**(각자 자기 hook 호출). 진입 `SettingEditor`가 `typeof initialValue === "boolean"`으로 분기.

## Deps

없음(boolean 에디터는 범용 — task-01의 leave 키가 첫 소비처일 뿐).

## TDD steps

### Step 1 — 테스트 작성(실패 확인)

`tests/app/admin/settings-editor.test.tsx` 신규 작성:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// 모호한 쓰기 결과 시 권위 상태 재조회용 router.refresh 모킹.
const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { SettingEditor } from "@/app/(app)/admin/settings/settings-editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  routerRefresh.mockClear();
});

describe("SettingEditor — boolean 분기", () => {
  it("boolean initialValue → Switch 렌더(textarea 아님)", () => {
    render(<SettingEditor settingKey="leave.notifications.onRequest" initialValue={true} updatedAt={null} />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Switch 클릭 → PUT(value:false·expectedUpdatedAt 토큰)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ updatedAt: "2026-06-25T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SettingEditor
        settingKey="leave.notifications.onApprove"
        initialValue={true}
        updatedAt="2026-06-24T00:00:00.000Z"
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/settings/leave.notifications.onApprove");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.value).toBe(false);
    expect(body.expectedUpdatedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("PUT 409(서버 미반영 확실) → 토글 롤백 + router.refresh 미호출", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onReject" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    // 409=rejected(서버 미반영 확실) → 안전 롤백. refresh 불필요.
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("PUT fetch 거부(응답 수신 실패=ambiguous) → 롤백 대신 router.refresh로 권위 상태 재조회 + 재활성화", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onApprove" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch") as HTMLButtonElement;
    fireEvent.click(sw);
    // 응답 수신 실패 → 반영 여부 불명 → 단정(롤백) 금지, refresh로 진짜 상태 재조회.
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    expect(sw.disabled).toBe(false); // saving 해제(재활성화)
  });

  it("비boolean initialValue → 기존 textarea 경로 유지(Switch 없음)", () => {
    render(<SettingEditor settingKey="integrations.smtp.host" initialValue={"smtp.example.com"} updatedAt={null} />);
    expect(document.querySelector("textarea")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
```

실행(FAIL 기대 — 현재 에디터는 항상 textarea, Switch 미존재):

```bash
npx vitest run tests/app/admin/settings-editor.test.tsx
```

### Step 2 — settings-editor.tsx 구현

`src/app/(app)/admin/settings/settings-editor.tsx` **전체**를 아래로 교체한다(기존 textarea 로직은 `JsonSettingEditor`로 그대로 이동 — 회귀 없음):

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type EditorProps = {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null; // ISO 또는 null(아직 override 없음)
};

export function SettingEditor(props: EditorProps) {
  // boolean 설정은 토글 UI, 그 외는 기존 raw JSON textarea(회귀 없음).
  if (typeof props.initialValue === "boolean") {
    return (
      <BooleanSettingEditor
        settingKey={props.settingKey}
        initialValue={props.initialValue}
        updatedAt={props.updatedAt}
      />
    );
  }
  return <JsonSettingEditor {...props} />;
}

// PUT 공통 결과(판별 유니온): **절대 throw하지 않는다.**
//  - ok       : 서버가 새 토큰을 확정 반환 → 성공.
//  - rejected : 정의된 "미반영" 응답(409/422/그 외 !ok). 서버가 쓰지 않았음이 확실 → 안전하게 롤백.
//  - ambiguous: 응답을 받지 못함(fetch 거부) 또는 2xx인데 본문 파싱 실패. **반영됐을 수 있음** →
//               낙관값·롤백 모두 거짓일 수 있으니 단정하지 말고 권위 상태를 재조회해야 한다.
type PutResult = { kind: "ok"; token: string } | { kind: "rejected" } | { kind: "ambiguous" };

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
    // 요청 전송/응답 수신 실패 — 서버 반영 여부 불명.
    return { kind: "ambiguous" };
  }
  if (res.status === 409) {
    toast.error("다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.");
    return { kind: "rejected" };
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
    if (typeof body.updatedAt !== "string") return { kind: "ambiguous" };
    toast.success("저장되었습니다.");
    return { kind: "ok", token: body.updatedAt };
  } catch {
    // 2xx인데 본문 파싱 실패 — 반영됐을 가능성.
    return { kind: "ambiguous" };
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

  // 서버 권위 상태 재동기화: router.refresh() 후 server component가 새 initialValue/updatedAt을 내려보내면 반영.
  // (useState 초기화는 1회뿐이므로, refresh로 갱신된 props를 토글 상태에 흘려보내려면 이 sync가 필요.)
  useEffect(() => {
    setChecked(initialValue);
    setToken(updatedAt);
  }, [initialValue, updatedAt]);

  async function toggle(next: boolean) {
    const prev = checked;
    setChecked(next); // 낙관적 업데이트
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, next, token);
    } finally {
      setSaving(false); // 성공·실패·예외 무관 항상 재활성화
    }
    if (result.kind === "ok") {
      setToken(result.token);
      return;
    }
    if (result.kind === "rejected") {
      setChecked(prev); // 서버 미반영 확실 → 롤백
      return;
    }
    // ambiguous: 반영 여부 불명 → 낙관값/롤백을 단정하지 말고 권위 상태 재조회(거짓 표시 방지).
    toast.error("저장 결과를 확인할 수 없습니다 — 최신 상태로 갱신합니다.");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={toggle} disabled={saving} label={settingKey} />
      <span className="text-sm text-muted-foreground">{checked ? "켜짐" : "꺼짐"}</span>
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
    // 클라이언트는 최소 UX 검증(JSON 파싱)만. 진짜 검증은 서버 Zod.
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
    if (result.kind === "ok") {
      setToken(result.token);
      return;
    }
    if (result.kind === "ambiguous") {
      // JSON 경로는 사용자가 입력한 textarea 내용을 보존해야 하므로 refresh(=props 재초기화)하지 않는다.
      // 토큰을 갱신하지 않아 다음 저장 시 409가 나면 사용자가 새로고침으로 확인하도록 유도.
      toast.error("저장 결과를 확인할 수 없습니다 — 새로고침 후 상태를 확인하세요.");
    }
    // rejected: putSetting이 이미 사유 토스트를 띄움. 토큰·텍스트 유지(사용자가 수정/재시도).
  }

  return (
    <div className="grid gap-1.5">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="font-mono"
      />
      <div>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}
```

실행(PASS 기대):

```bash
npx vitest run tests/app/admin/settings-editor.test.tsx
```

### Step 3 — 검증 + 커밋

```bash
npm run typecheck
npm run lint
npm test
```

전부 통과하면 커밋:

```bash
git add "src/app/(app)/admin/settings/settings-editor.tsx" tests/app/admin/settings-editor.test.tsx
git commit -m "feat(settings): boolean 설정 토글 에디터(Switch)"
```

## Acceptance Criteria

- `npx vitest run tests/app/admin/settings-editor.test.tsx` — boolean→Switch·토글 PUT(value/token)·409 롤백(refresh 미호출)·**fetch 거부=ambiguous→router.refresh+재활성화**·비boolean→textarea 5케이스 통과.
- `npm run typecheck` / `npm run lint` — 통과.
- `npm test` — 전체 그린.

## Cautions

- **조건부로 hook을 호출하지 마라.** `SettingEditor` 한 컴포넌트 안에서 `if (boolean) useState(...)` 식 분기는 React hook 규칙 위반(lint 에러). 반드시 `BooleanSettingEditor`/`JsonSettingEditor` 두 컴포넌트로 분리해 각자 hook을 호출한다.
- **기존 textarea 동작을 바꾸지 마라.** `JsonSettingEditor`는 기존 `SettingEditor` 로직과 동일(저장 버튼·JSON 파싱·토큰 흐름). PUT 호출만 공통 `putSetting`으로 추출 — 동작 동일.
- 토글은 **별도 저장 버튼 없음**(변경 즉시 PUT). 저장 중(`saving`) Switch 비활성화로 더블클릭 방지.
- **`putSetting`은 절대 throw하면 안 된다.** fetch 거부(네트워크 끊김·abort)·`res.json()` 파싱 실패를 catch하지 않으면 호출부의 `setSaving(false)`·롤백이 건너뛰어져 토글이 "비활성·잘못된 값"으로 고착된다. 호출부는 `try/finally`로 `saving`을 항상 해제한다(이중 방어).
- **모호한 쓰기 결과(ambiguous)를 "미반영"으로 단정해 롤백하지 마라.** 응답을 못 받았거나(fetch 거부) 2xx 본문 파싱이 실패하면 **서버가 이미 반영했을 수 있다** — 롤백하면 "꺼졌는데 켜진 것처럼" 보이는 거짓 표시 + stale 토큰으로 다음 변경에서 혼란스러운 409가 난다. boolean 토글은 `router.refresh()`로 권위 상태를 재조회하고, **롤백은 정의된 미반영 응답(409/422/!ok)에만** 적용한다. JSON 경로는 사용자 textarea 입력 보존을 위해 refresh하지 않고 경고만 띄운다.
- **`useEffect`로 props→state 재동기화 필수.** `router.refresh()`가 새 `initialValue`/`updatedAt`을 내려보내도 `useState` 초기화는 1회뿐이라 자동 반영되지 않는다 — `useEffect(() => { setChecked(initialValue); setToken(updatedAt); }, [initialValue, updatedAt])`로 동기화해야 refresh가 토글 표시에 반영된다.
- `putSetting`은 `@/components/ui` 프리미티브를 새로 만들지 않는다(`Switch` 재사용 — 신설은 비목표).
