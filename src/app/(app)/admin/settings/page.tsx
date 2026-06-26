import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { listSettings } from "@/kernel/settings";
import { getIntegrationStatuses, type IntegrationKey } from "@/modules/integrations";
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
const GROUP_INTEGRATION: Partial<Record<string, IntegrationKey>> = {
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
