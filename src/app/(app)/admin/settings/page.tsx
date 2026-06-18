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
