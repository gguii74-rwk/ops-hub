# Task 08 — UI: 설정 홈 + 카테고리 섹션 + 상태 카드 + systemSetting 편집기

**Purpose:** `/admin/settings` 설정 홈. 서버에서 권한 게이트 + `listSettings`/`getIntegrationStatuses`로 데이터를 그리고, systemSetting 항목은 클라이언트 편집기(최소 UX 검증·서버 Zod 기준·optimistic concurrency)로 수정한다.

## Files

- Create: `src/app/(app)/admin/settings/page.tsx` — 서버 컴포넌트(게이트 + 데이터 + 렌더).
- Create: `src/app/(app)/admin/settings/settings-editor.tsx` — 클라이언트 편집기.
- Test: 없음(UI 단위테스트 인프라 미도입 — Phase 1 동일). 검증은 build + 수동 스모크.

## Prep

- spec §7.1·§7.2, entrypoint §SC-3. Phase 1 패턴: 서버 페이지 `auth()`+`hasPermission`+redirect, 클라이언트 `"use client"`.
- `listSettings(uid)`는 admin 게이트 포함. `SettingsCatalogItem`(§SC-3) 형태 소비.

## Deps

- Task 06(`getIntegrationStatuses(userId)`), Task 07(PUT API).

## TDD steps

> UI 컴포넌트 단위테스트 인프라(jsdom/testing-library)는 이 저장소에 없고 Phase 1도 도입하지 않았다. 본 task는 **typecheck/lint/build + 수동 스모크**로 검증한다(로직 보유 계층은 task 01–07·09에서 테스트됨). 데이터/권한 경로는 task 04·07 테스트가 이미 커버한다.

### 1. 구현 — `src/app/(app)/admin/settings/settings-editor.tsx`

```tsx
"use client";

import { useState } from "react";

export function SettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null; // ISO 또는 null(아직 override 없음)
}) {
  const [text, setText] = useState(() => JSON.stringify(initialValue, null, 2));
  const [token, setToken] = useState<string | null>(updatedAt);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    // 클라이언트는 최소 UX 검증(JSON 파싱)만. 진짜 검증은 서버 Zod.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setMessage("형식 오류: 올바른 JSON이 아닙니다.");
      return;
    }
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/admin/settings/${encodeURIComponent(settingKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: parsed, expectedUpdatedAt: token }),
    });
    setSaving(false);
    if (res.status === 409) {
      setMessage("다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.");
      return;
    }
    if (res.status === 422) {
      setMessage("검증 실패: 값 형식을 확인하세요.");
      return;
    }
    if (!res.ok) {
      setMessage("저장 실패.");
      return;
    }
    const body = (await res.json()) as { updatedAt: string };
    setToken(body.updatedAt);
    setMessage("저장됨.");
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{ fontFamily: "monospace", width: "100%" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
        {message ? <span style={{ color: "var(--muted)" }}>{message}</span> : null}
      </div>
    </div>
  );
}
```

### 2. 구현 — `src/app/(app)/admin/settings/page.tsx`

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { listSettings } from "@/kernel/settings";
import { getIntegrationStatuses } from "@/modules/integrations";
import { SettingEditor } from "./settings-editor";

const CATEGORY_LABELS: Record<string, string> = {
  security: "보안",
  integrations: "연동",
  workflows: "업무",
  general: "일반",
};
const CATEGORY_ORDER = ["security", "integrations", "workflows", "general"] as const;
const INTEGRATION_LABELS: Record<string, string> = { smtp: "메일(SMTP)", google: "Google", templates: "문서/템플릿" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "admin.settings", "view"))) {
    redirect("/dashboard");
  }

  const [items, integrations] = await Promise.all([
    listSettings(session.user.id),
    getIntegrationStatuses(session.user.id),
  ]);

  return (
    <section style={{ display: "grid", gap: 24 }}>
      <h1>설정</h1>

      {integrations.length > 0 ? (
        <div>
          <h2 style={{ fontSize: 16 }}>연동 상태</h2>
          <ul style={{ display: "flex", gap: 16, listStyle: "none", padding: 0 }}>
            {integrations.map((s) => (
              <li key={s.key}>
                {INTEGRATION_LABELS[s.key] ?? s.key}:{" "}
                <strong>{s.health === "configured" ? "정상" : "설정 필요"}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {CATEGORY_ORDER.map((cat) => {
        const group = items.filter((i) => i.category === cat);
        if (group.length === 0) return null;
        return (
          <div key={cat}>
            <h2 style={{ fontSize: 16 }}>{CATEGORY_LABELS[cat]}</h2>
            <ul style={{ display: "grid", gap: 12, listStyle: "none", padding: 0 }}>
              {group.map((item) => (
                <li key={item.key} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>{item.description}</div>
                  {item.kind === "systemSetting" ? (
                    item.status === "INVALID" ? (
                      <div style={{ color: "crimson", fontSize: 13 }}>저장된 값이 올바르지 않습니다 — 다시 저장하세요.</div>
                    ) : null
                  ) : null}
                  {item.kind === "systemSetting" ? (
                    <SettingEditor
                      settingKey={item.key}
                      initialValue={item.value}
                      updatedAt={item.updatedAt ? new Date(item.updatedAt).toISOString() : null}
                    />
                  ) : item.kind === "envSecret" ? (
                    <div style={{ fontSize: 13 }}>
                      상태: <strong>{item.status === "configured" ? "정상" : "설정 필요"}</strong>
                    </div>
                  ) : (
                    <Link href={item.manageHref ?? "#"}>관리 →</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
```

### 3. typecheck/lint/build

```bash
npm run typecheck && npm run lint && npm run build
```

기대: 에러 0, build 라우트에 `/admin/settings` 등장.

### 4. 수동 스모크 (로컬 dev + seed 된 OWNER 로그인)

```bash
npm run dev
```

- `/admin/settings` 접속 → "연동 상태" + 카테고리 섹션(보안/연동/업무) 렌더.
- SMTP 호스트 편집기에 `"mail.example.com"` 저장 → "저장됨". 재저장 시 토큰 갱신.
- 동일 항목을 다른 탭에서 먼저 저장 후 이전 탭 저장 → "다른 사용자가 먼저 변경" 메시지(409).
- `admin.settings:view` 없는 계정 → `/admin/settings`가 `/dashboard`로 redirect.
- `integrations.google:view` 없는 계정 → "연동 상태"에 Google 항목 미표시(연동별 게이트).

### 5. 커밋

```bash
git add "src/app/(app)/admin/settings"
git commit -m "Add settings home UI with category sections and systemSetting editor"
```

## Acceptance Criteria

- `npm run typecheck` / `npm run lint` / `npm run build` → 에러 0, `/admin/settings` 빌드.
- 수동 스모크 4항목 통과.
- envSecret 항목은 상태만(값/편집기 없음), relational은 관리 링크, systemSetting은 편집기.

## Cautions

- **클라이언트로 카탈로그/Zod 스키마를 내려보내지 말 것. 이유:** Codex Finding 2. 편집기는 제네릭 JSON textarea + 최소 검증만, 서버 Zod가 기준.
- **`updatedAt`은 ISO 문자열로 직렬화해 전달. 이유:** RSC→client Date 직렬화 모호성 회피. API는 `new Date(iso)`로 복원해 concurrency 토큰으로 사용(§5.7).
- **`item.value`는 systemSetting에만 존재. envSecret 분기에서 값 접근 금지. 이유:** secret 값은 응답에 없음(undefined). 상태만 표시.
- **page는 서버 컴포넌트로 유지(`"use client"` 금지). 이유:** `listSettings`/`getIntegrationStatuses`/`auth`는 server-only. 상호작용만 `settings-editor`(client)로 분리.
- **`getIntegrationStatuses`에 `session.user.id`를 반드시 전달, 결과가 비면 "연동 상태" 섹션 미렌더. 이유:** 연동 상태도 연동별 `integrations.<key>:view`로 서버에서 게이트(Codex 2차 리뷰 F1). 인자 없이 호출하면 권한 없는 연동 구성 여부가 노출된다.
