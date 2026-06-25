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

  it("PUT 409(행 변경됨=stale) → 롤백 대신 router.refresh로 권위 재조회", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onReject" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch") as HTMLButtonElement;
    fireEvent.click(sw);
    // 409=다른 사용자가 행 변경 → prev도 stale이므로 롤백 금지, refetch로 진짜 상태 재조회.
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    expect(sw.disabled).toBe(false);
  });

  it("PUT 422(값 거부·행 불변=rejected) → prev로 롤백 + router.refresh 미호출", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onReject" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    // 422=값 거부, 행 불변 → prev가 권위값 → 안전 롤백, refresh 불필요.
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("PUT fetch 거부(응답 수신 실패=refetch) → 롤백 대신 router.refresh로 권위 상태 재조회 + 재활성화", async () => {
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
    // 요청 전송/응답 수신 실패 — 반영 여부 불명.
    toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 409) {
    // 행이 이미 변경됨 → prev도 stale. 롤백 금지, 권위 재조회.
    toast.error("다른 사용자가 먼저 변경했습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 422) {
    toast.error("검증 실패: 값 형식을 확인하세요.");
    return { kind: "rejected" }; // 값 거부, 행 불변 → prev 권위 유지
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
    // 2xx인데 본문 파싱 실패 — 반영됐을 가능성.
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
      setChecked(prev); // 값 거부·행 불변 → prev가 권위값 → 롤백
      return;
    }
    // refetch: prev/next 모두 stale일 수 있음(409 충돌 또는 결과 불명) → 단정 금지, 권위 상태 재조회.
    // (toast는 putSetting이 이미 띄움. useEffect가 새 props를 토글 상태에 반영.)
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
    if (result.kind === "ok") setToken(result.token);
    // rejected/refetch: putSetting이 이미 사유 토스트를 띄움. JSON 경로는 사용자가 입력한 textarea 내용을
    // 보존해야 하므로 router.refresh(=props 재초기화)하지 않는다(토큰 미갱신 → 다음 저장 시 409로 재확인 유도).
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

- `npx vitest run tests/app/admin/settings-editor.test.tsx` — boolean→Switch·토글 PUT(value/token)·**409=stale→router.refresh**·**422=행불변→prev 롤백(refresh 미호출)**·**fetch 거부=refetch→router.refresh+재활성화**·비boolean→textarea 6케이스 통과.
- `npm run typecheck` / `npm run lint` — 통과.
- `npm test` — 전체 그린.

## Cautions

- **조건부로 hook을 호출하지 마라.** `SettingEditor` 한 컴포넌트 안에서 `if (boolean) useState(...)` 식 분기는 React hook 규칙 위반(lint 에러). 반드시 `BooleanSettingEditor`/`JsonSettingEditor` 두 컴포넌트로 분리해 각자 hook을 호출한다.
- **기존 textarea 동작을 바꾸지 마라.** `JsonSettingEditor`는 기존 `SettingEditor` 로직과 동일(저장 버튼·JSON 파싱·토큰 흐름). PUT 호출만 공통 `putSetting`으로 추출 — 동작 동일.
- 토글은 **별도 저장 버튼 없음**(변경 즉시 PUT). 저장 중(`saving`) Switch 비활성화로 더블클릭 방지.
- **`putSetting`은 절대 throw하면 안 된다.** fetch 거부(네트워크 끊김·abort)·`res.json()` 파싱 실패를 catch하지 않으면 호출부의 `setSaving(false)`·롤백이 건너뛰어져 토글이 "비활성·잘못된 값"으로 고착된다. 호출부는 `try/finally`로 `saving`을 항상 해제한다(이중 방어).
- **409를 롤백하지 마라 — refetch하라(R5 적대검증).** 409는 "다른 사용자가 행을 이미 바꿈"이라 낙관값 `next`도 롤백 대상 `prev`도 **둘 다 stale**이다. 롤백하면 "DB는 OFF인데 화면은 ON"인 거짓 권위 상태를 보인다. boolean 토글은 `router.refresh()`로 권위 재조회. **롤백(`setChecked(prev)`)은 `rejected`(422 등 값-거부·행-불변)에만** — 그땐 `prev`가 여전히 권위값이다.
- **응답 미수신(fetch 거부)·2xx 본문 파싱 실패도 refetch.** 서버가 반영했을 수 있어 단정 금지. `refetch` = {409 stale} ∪ {결과 불명}. JSON 경로는 textarea 입력 보존을 위해 refresh하지 않고 토스트만(putSetting이 전담).
- **`useEffect`로 props→state 재동기화 필수.** `router.refresh()`가 새 `initialValue`/`updatedAt`을 내려보내도 `useState` 초기화는 1회뿐이라 자동 반영되지 않는다 — `useEffect(() => { setChecked(initialValue); setToken(updatedAt); }, [initialValue, updatedAt])`로 동기화해야 refresh가 토글 표시에 반영된다.
- `putSetting`은 `@/components/ui` 프리미티브를 새로 만들지 않는다(`Switch` 재사용 — 신설은 비목표).
