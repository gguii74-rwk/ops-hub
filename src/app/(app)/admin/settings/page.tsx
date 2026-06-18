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
// 연동 상태 3-state: configured/attention_required/unknown(인프라 장애 — 설정 누락과 구분, task-06).
const INTEGRATION_HEALTH_LABELS: Record<string, string> = {
  configured: "정상",
  attention_required: "설정 필요",
  unknown: "확인 불가(일시 오류)",
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
    <section style={{ display: "grid", gap: 24 }}>
      <h1>설정</h1>

      {integrations.length > 0 ? (
        <div>
          <h2 style={{ fontSize: 16 }}>연동 상태</h2>
          <ul style={{ display: "flex", gap: 16, listStyle: "none", padding: 0 }}>
            {integrations.map((s) => (
              <li key={s.key}>
                {INTEGRATION_LABELS[s.key] ?? s.key}:{" "}
                <strong>{INTEGRATION_HEALTH_LABELS[s.health] ?? s.health}</strong>
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
