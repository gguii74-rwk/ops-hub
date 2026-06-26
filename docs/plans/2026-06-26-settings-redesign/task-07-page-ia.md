# Task 07 — 설정 페이지 IA: 그룹 카드 + 헤더 상태 배지

**Purpose**: `/admin/settings`를 `category` 평면 나열에서 **영역(group)별 카드**로 재편한다. 상단 "연동 상태" 요약 카드를 제거하고(D4), 각 그룹 카드 헤더에 해당 연동 상태 배지를 둔다. `secret.smtp` 무인증 릴레이 시 `not_required`("인증 미사용") 중립 배지를 렌더한다(F12 시각화).

## Files

- Modify `src/app/(app)/admin/settings/page.tsx`

## Prep

- 엔트리포인트 §Shared Contracts SC-4(그룹/순서·헤더 배지 매핑), SC-5(`not_required`).
- spec §5.3 "페이지".
- **Deps: task-01**(`item.group`/`groupOrder`), **task-05**(상태 진실화 + `not_required` + secret.smtp 행), **task-06**(타입별 편집기).

## TDD steps

> 페이지는 async server component라 단위 테스트 스위트가 없다. 검증은 **typecheck/lint/build + 전체 테스트 그린 + 수동 smoke**. 타입 계약(item.group/groupOrder/not_required)이 task-01·05와 일치해야 typecheck를 통과한다.

### Step 1 — page.tsx 전체 교체

`src/app/(app)/admin/settings/page.tsx`를 아래 전체 내용으로 교체한다:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { listSettings } from "@/kernel/settings";
import { getIntegrationStatuses } from "@/modules/integrations";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/ui/page-section";
import { SettingEditor } from "./settings-editor";

// 표시 그룹(D7) — category가 아니라 group으로 렌더링. 순서·라벨은 여기서 결정.
const GROUP_LABELS: Record<string, string> = {
  security: "보안",
  mail: "메일 (SMTP)",
  google: "Google",
  documents: "문서 / 템플릿",
  leave: "연차 알림",
  workflows: "업무",
};
const GROUP_ORDER = ["security", "mail", "google", "documents", "leave", "workflows"] as const;
// 그룹 헤더 배지에 매핑되는 연동 key(없는 그룹은 헤더 배지 생략).
const GROUP_INTEGRATION: Record<string, string | undefined> = {
  mail: "smtp",
  google: "google",
  documents: "templates",
};
// 연동 상태 3-state: configured/attention_required/unknown(인프라 장애 — 설정 누락과 구분).
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
  const healthByKey = new Map(integrations.map((s) => [s.key, s.health]));

  return (
    <section className="grid gap-6">
      <PageHeader title="설정" />

      {GROUP_ORDER.map((group) => {
        const groupItems = items
          .filter((i) => i.group === group)
          .sort((a, b) => a.groupOrder - b.groupOrder);
        if (groupItems.length === 0) return null;

        const integrationKey = GROUP_INTEGRATION[group];
        const health = integrationKey ? healthByKey.get(integrationKey) : undefined;

        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{GROUP_LABELS[group] ?? group}</CardTitle>
              {health ? (
                <CardAction>
                  <Badge variant={HEALTH_VARIANT[health] ?? "outline"}>
                    {INTEGRATION_HEALTH_LABELS[health] ?? health}
                  </Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-4">
              {groupItems.map((item, idx) => (
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
                      {item.status === "configured" ? (
                        <Badge variant="secondary">정상</Badge>
                      ) : item.status === "not_required" ? (
                        <Badge variant="outline">인증 미사용</Badge>
                      ) : (
                        <Badge variant="outline">설정 필요</Badge>
                      )}
                      {item.status === "not_required" ? (
                        <span className="ml-1 text-muted-foreground">(무인증 릴레이 — 비밀번호 불필요)</span>
                      ) : null}
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

### Step 2 — 검증

```bash
npm run typecheck   # item.group/groupOrder/status==="not_required" 계약 일치
npm run lint
npm run build       # 서버 컴포넌트 컴파일
npm test            # 전체 그린(회귀 없음)
```

## Acceptance Criteria

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 errors
npm run build       # 성공(페이지 컴파일)
npm test            # 전체 그린
```

수동 smoke(배포 후): 인증 → `/admin/settings`에서 ① 그룹 카드 6개 순서(보안→메일→Google→문서→연차알림→업무, 권한 보유분), ② 메일/Google/문서 헤더에 상태 배지, ③ 상단 "연동 상태" 요약 카드 **부재**, ④ SMTP 비밀번호 행이 무인증 릴레이면 "인증 미사용"(설정 필요 아님), ⑤ calendarIds/주간보고 수신자가 리스트 편집기, port가 숫자 입력, 발신주소가 텍스트 입력.

## Cautions

- **Don't 상단 "연동 상태" 요약 카드를 남기지 마라.** Reason: D4 — 요약-본문 이중 상태 계산이 원래 모순(요약 "설정 필요" vs 실제 발송 정상)의 원인. 상태는 그룹 헤더 배지 한 곳으로 일원화.
- **Don't `category`로 버킷팅하지 마라.** Reason: 렌더링은 `group`+`groupOrder` 기준(D7). `category`는 보존되지만 화면 분류는 group이다.
- **Don't `not_required`를 "설정 필요"로 렌더하지 마라.** Reason: F12 — 무인증 릴레이는 비밀번호가 불필요한 정상 상태. "설정 필요"로 표시하면 그룹 헤더(정상)와 모순(원래 버그 재발).
- **Don't `manageHref` 패턴을 calendarIds에 적용하지 마라.** Reason: PR-A는 calendarIds를 systemSetting 리스트 편집기로 유지(F13·D6). relational "관리 →" 링크는 billing.config(미구현 placeholder)에만. Google 소스 관리 화면은 PR-B.
- **Don't 헤더 배지를 security/leave/workflows 그룹에 달지 마라.** Reason: 그 그룹들은 연동 상태가 없다(GROUP_INTEGRATION에 없음). 항목별 envSecret 배지/편집기로 충분.
