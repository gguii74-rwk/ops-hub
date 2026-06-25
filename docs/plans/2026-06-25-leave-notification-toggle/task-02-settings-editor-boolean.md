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

import { SettingEditor } from "@/app/(app)/admin/settings/settings-editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it("PUT 409 → 토글 상태 롤백(원래 값 복원)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingEditor settingKey="leave.notifications.onReject" initialValue={true} updatedAt={null} />);
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    // 비동기 PUT(409) 해소 후 롤백 — waitFor로 재렌더까지 대기(act 래핑)
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
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

import { useState } from "react";
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

// PUT 공통: 성공 시 새 토큰 반환, 실패 시 사용자 토스트 후 null.
async function putSetting(
  settingKey: string,
  value: unknown,
  token: string | null,
): Promise<string | null> {
  const res = await fetch(`/api/admin/settings/${encodeURIComponent(settingKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, expectedUpdatedAt: token }),
  });
  if (res.status === 409) {
    toast.error("다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.");
    return null;
  }
  if (res.status === 422) {
    toast.error("검증 실패: 값 형식을 확인하세요.");
    return null;
  }
  if (!res.ok) {
    toast.error("저장에 실패했습니다.");
    return null;
  }
  const body = (await res.json()) as { updatedAt: string };
  toast.success("저장되었습니다.");
  return body.updatedAt;
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
  const [checked, setChecked] = useState(initialValue);
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    const prev = checked;
    setChecked(next); // 낙관적 업데이트
    setSaving(true);
    const newToken = await putSetting(settingKey, next, token);
    setSaving(false);
    if (newToken === null) {
      setChecked(prev); // 실패 → 롤백
      return;
    }
    setToken(newToken);
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
    const newToken = await putSetting(settingKey, parsed, token);
    setSaving(false);
    if (newToken !== null) setToken(newToken);
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

- `npx vitest run tests/app/admin/settings-editor.test.tsx` — boolean→Switch·토글 PUT(value/token)·409 롤백·비boolean→textarea 4케이스 통과.
- `npm run typecheck` / `npm run lint` — 통과.
- `npm test` — 전체 그린.

## Cautions

- **조건부로 hook을 호출하지 마라.** `SettingEditor` 한 컴포넌트 안에서 `if (boolean) useState(...)` 식 분기는 React hook 규칙 위반(lint 에러). 반드시 `BooleanSettingEditor`/`JsonSettingEditor` 두 컴포넌트로 분리해 각자 hook을 호출한다.
- **기존 textarea 동작을 바꾸지 마라.** `JsonSettingEditor`는 기존 `SettingEditor` 로직과 동일(저장 버튼·JSON 파싱·토큰 흐름). PUT 호출만 공통 `putSetting`으로 추출 — 동작 동일.
- 토글은 **별도 저장 버튼 없음**(변경 즉시 PUT). 저장 중(`saving`) Switch 비활성화로 더블클릭 방지.
- `putSetting`은 `@/components/ui` 프리미티브를 새로 만들지 않는다(`Switch` 재사용 — 신설은 비목표).
