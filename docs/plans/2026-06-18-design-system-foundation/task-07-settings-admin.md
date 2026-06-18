# Task 07 — settings + admin 마이그레이션 + 최종 검증

`admin/settings` 페이지·`settings-editor`·`admin` 페이지·`admin-links`를 디자인 시스템으로 마이그레이션한다. settings 저장 피드백을 sonner toast로 옮긴다. 마지막에 전체 검증·수동 스모크를 수행한다.

## Files
- Modify: `src/app/(app)/admin/settings/page.tsx`, `src/app/(app)/admin/settings/settings-editor.tsx`, `src/app/(app)/admin/page.tsx`, `src/app/(app)/admin/admin-links.tsx`

## Prep
- 스펙 §8(마이그레이션 표), settings-editor 접근성 주의
- 엔트리포인트 §Shared Contracts: Card, Badge, Separator, Textarea, Button, 토스트 계약
- 현재 settings page는 `listSettings`/`getIntegrationStatuses` 결과를 `item.kind`(`systemSetting`/`envSecret`/그 외) 분기로 렌더한다. 데이터 로직·권한 가드는 유지하고 마크업만 교체한다.

## Deps
- task-02 (Textarea, Button), task-03 (Card, Badge, Separator), task-04 (sonner toast)

## Steps

### 1. settings-editor.tsx — toast 피드백으로 교체
파일 전체를 교체한다. `setMessage`/인라인 `<span>`을 제거하고, 저장 버튼 `disabled`+"저장 중…" 상태는 유지하며, 실패 사유를 토스트 본문에 명확히 담는다.
```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

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
    const res = await fetch(`/api/admin/settings/${encodeURIComponent(settingKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: parsed, expectedUpdatedAt: token }),
    });
    setSaving(false);
    if (res.status === 409) {
      toast.error("다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.");
      return;
    }
    if (res.status === 422) {
      toast.error("검증 실패: 값 형식을 확인하세요.");
      return;
    }
    if (!res.ok) {
      toast.error("저장에 실패했습니다.");
      return;
    }
    const body = (await res.json()) as { updatedAt: string };
    setToken(body.updatedAt);
    toast.success("저장되었습니다.");
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

### 2. settings/page.tsx — Card + Badge로 교체
파일 전체를 교체한다.
```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { listSettings } from "@/kernel/settings";
import { getIntegrationStatuses } from "@/modules/integrations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SettingEditor } from "./settings-editor";

const CATEGORY_LABELS: Record<string, string> = {
  security: "보안",
  integrations: "연동",
  workflows: "업무",
  general: "일반",
};
const CATEGORY_ORDER = ["security", "integrations", "workflows", "general"] as const;
const INTEGRATION_LABELS: Record<string, string> = { smtp: "메일(SMTP)", google: "Google", templates: "문서/템플릿" };
// 연동 상태 3-state: configured/attention_required/unknown(인프라 장애 — 설정 누락과 구분, task-06).
const INTEGRATION_HEALTH_LABELS: Record<string, string> = {
  configured: "정상",
  attention_required: "설정 필요",
  unknown: "확인 불가(일시 오류)",
};
const HEALTH_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  configured: "secondary",
  attention_required: "destructive",
  unknown: "outline",
};

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
    <section className="grid gap-6">
      <h1 className="text-xl font-semibold">설정</h1>

      {integrations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>연동 상태</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {integrations.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-sm">
                {INTEGRATION_LABELS[s.key] ?? s.key}:
                <Badge variant={HEALTH_VARIANT[s.health] ?? "outline"}>
                  {INTEGRATION_HEALTH_LABELS[s.health] ?? s.health}
                </Badge>
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {CATEGORY_ORDER.map((cat) => {
        const group = items.filter((i) => i.category === cat);
        if (group.length === 0) return null;
        return (
          <Card key={cat}>
            <CardHeader>
              <CardTitle>{CATEGORY_LABELS[cat]}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {group.map((item, idx) => (
                <div key={item.key} className="grid gap-1.5">
                  {idx > 0 ? <Separator className="mb-2" /> : null}
                  <div className="font-medium">{item.title}</div>
                  <div className="text-sm text-muted-foreground">{item.description}</div>
                  {item.kind === "systemSetting" && item.status === "INVALID" ? (
                    <div className="text-sm text-destructive">
                      저장된 값이 올바르지 않습니다 — 다시 저장하세요.
                    </div>
                  ) : null}
                  {item.kind === "systemSetting" ? (
                    <SettingEditor
                      settingKey={item.key}
                      initialValue={item.value}
                      updatedAt={item.updatedAt ? new Date(item.updatedAt).toISOString() : null}
                    />
                  ) : item.kind === "envSecret" ? (
                    <div className="text-sm">
                      상태:{" "}
                      <Badge variant={item.status === "configured" ? "secondary" : "outline"}>
                        {item.status === "configured" ? "정상" : "설정 필요"}
                      </Badge>
                    </div>
                  ) : (
                    <Link
                      href={item.manageHref ?? "#"}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      관리 →
                    </Link>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
```

### 3. admin/page.tsx — 헤딩 정리
파일 전체를 교체한다.
```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { AdminLinks } from "./admin-links";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "admin.users", "view"))) {
    redirect("/dashboard");
  }
  return (
    <section className="grid gap-4">
      <h1 className="text-xl font-semibold">관리</h1>
      <AdminLinks />
    </section>
  );
}
```

### 4. admin-links.tsx — 클래스 정리
파일 전체를 교체한다(권한 분기 로직 유지).
```tsx
"use client";

import { useCan } from "@/lib/auth/permissions-client";

export function AdminLinks() {
  const canAudit = useCan("admin.audit", "view");
  const canUsers = useCan("admin.users", "view");
  return (
    <ul className="grid gap-1 text-sm text-muted-foreground">
      {canUsers ? <li>사용자</li> : null}
      {canAudit ? <li>감사 로그</li> : null}
    </ul>
  );
}
```

### 5. 최종 검증 + 커밋
```
npm run typecheck
npm run lint
npm run build
npm test
git add "src/app/(app)/admin"
git commit -m "Migrate settings and admin pages to design system; toast feedback"
```

## Acceptance Criteria
- `npm run typecheck` → 0 errors
- `npm run lint` → 0 errors (boundaries 포함; `app → ui` import 허용)
- `npm run build` → 성공
- `npm test` → 92개(+`cn` 3개) 통과, 회귀 없음
- 전체 수동 스모크(dev 서버, admin 계정):
  - `/login` 로그인 → `/dashboard`
  - 셸 사이드바/본문 렌더, 좌하단 토글로 light↔dark 즉시 전환
  - `/admin/settings` 렌더: 연동 상태 Badge, 카테고리 Card, systemSetting 편집기
  - systemSetting 저장 → "저장되었습니다." 성공 토스트
  - 2개 탭에서 동시 편집 → 한쪽 저장 후 다른 쪽 저장 시 409 → "다른 사용자가 먼저 변경…" 에러 토스트
  - 비권한 계정 → `/admin/settings` 접근 시 `/dashboard`로 redirect

## Cautions
- **데이터 로직·권한 가드(`auth`/`hasPermission`/`listSettings`/`getIntegrationStatuses`)와 `item.kind` 분기 구조를 바꾸지 말 것.** Reason: 이번 작업은 프레젠테이션 마이그레이션이다. 권한·데이터 동작은 범위 밖.
- **settings-editor에서 저장 버튼 `disabled`+"저장 중…"을 제거하지 말 것.** Reason: toast만으로는 진행 중 상태가 시각적으로 드러나지 않는다. 실패 사유는 toast 본문에 담아 sonner의 aria-live로 안내한다.
- **placeholder 화면(dashboard/calendar/leave/workflows)은 건드리지 말 것.** Reason: 새 셸이 자동 적용되며 본문 변경은 범위 밖이다.
- `listSettings` 반환 타입의 `item.status`/`item.value`/`item.manageHref` 필드명을 임의로 바꾸지 말 것. Reason: 기존 `@/kernel/settings` 계약을 그대로 소비한다.
