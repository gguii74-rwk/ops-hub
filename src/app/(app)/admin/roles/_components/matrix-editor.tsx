"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-section";
import { StatStrip, Stat } from "@/components/ui/stat-strip";
import { groupPermissions, type GroupDef } from "./grouping";

interface Matrix {
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: Array<{ id: string; resource: string; action: string }>;
  rules: Array<{ roleId: string; permissionId: string; effect: "ALLOW" | "DENY"; scope: string }>;
}

type Effect = "none" | "ALLOW" | "DENY";

// 셀 세그먼트 토글(허용/거부/·). 활성 = 허용(brand)·거부(rose)·중립. ALLOW + 다중 scope면 scope 셀렉트 동반.
function SegmentCell({
  effect, scope, scopes, onSet,
}: {
  effect: Effect; scope: string; scopes: string[];
  onSet: (effect: Effect, scope: string) => void;
}) {
  const seg = (val: Effect, label: string, activeCls: string) => (
    <button
      type="button"
      aria-pressed={effect === val}
      onClick={() => onSet(val, val === "ALLOW" ? scope : "all")}
      className={cn(
        "px-2 py-1 text-[11px] font-medium border-l border-border first:border-l-0 transition-colors",
        effect === val ? activeCls : "text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-1">
      <span className="inline-flex overflow-hidden rounded-md border border-border">
        {seg("ALLOW", "허용", "bg-brand text-white")}
        {seg("DENY", "거부", "bg-rose-600 text-white")}
        {seg("none", "·", "bg-muted text-foreground")}
      </span>
      {effect === "ALLOW" && scopes.length > 1 && (
        <Select className="h-7 w-auto py-0 text-xs" value={scope} onChange={(e) => onSet("ALLOW", e.target.value)}>
          {scopes.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      )}
    </div>
  );
}

export function MatrixEditor({
  matrix, scopeOptions, groups, canConfigure,
}: {
  matrix: Matrix;
  scopeOptions: Record<string, string[]>;
  groups: GroupDef[];
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const ruleKey = (r: string, p: string) => `${r}:${p}`;
  const byCell = new Map(matrix.rules.map((x) => [ruleKey(x.roleId, x.permissionId), x]));
  const grouped = groupPermissions(matrix.permissions, groups);

  async function setCell(roleId: string, permissionId: string, effect: string, scope: string) {
    setErr(null); setNotice(null);
    const res = await fetch(`/api/admin/roles/${roleId}/permissions/${permissionId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effect, scope }),
    });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "오류"); return; }
    router.refresh();
  }

  async function bulkSet(roleId: string, roleName: string, group: { key: string; label: string }, effect: string) {
    if (!effect) return;
    setErr(null); setNotice(null); setBusy(true);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}/permissions/bulk`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourcePrefix: group.key, effect }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "오류"); return; }
      const label = effect === "ALLOW" ? "ALLOW" : effect === "DENY" ? "DENY" : "해제";
      let msg = `${group.label} → ${roleName}: ${data.applied}건 적용(${label})`;
      if (Array.isArray(data.skipped) && data.skipped.length) {
        msg += `, ${data.skipped.length}건 건너뜀 (${data.skipped.map((s: { key: string }) => s.key).join(", ")})`;
      }
      setNotice(msg);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="접근 제어"
        title="권한 매트릭스"
        subtitle={canConfigure ? undefined : "읽기 전용 — 편집은 OWNER만 가능합니다."}
      />

      <StatStrip>
        <Stat value={matrix.roles.length} label="역할" />
        <Stat value={matrix.permissions.length} label="권한" />
      </StatStrip>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">권한</th>
                  {matrix.roles.map((r) => (
                    <th key={r.id} className="p-2 text-center text-[11px] font-semibold text-muted-foreground">{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map((group) => {
                  const isCollapsed = !!collapsed[group.key];
                  return (
                    <Fragment key={group.key}>
                      <tr className="border-t border-border bg-muted/50">
                        <td className="sticky left-0 z-10 bg-muted/50 p-1.5">
                          <button
                            type="button"
                            className="flex items-center gap-1 font-medium"
                            aria-expanded={!isCollapsed}
                            onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
                          >
                            <span aria-hidden>{isCollapsed ? "▶" : "▼"}</span>
                            {group.label}
                            <span className="text-muted-foreground">({group.permissions.length})</span>
                          </button>
                        </td>
                        {matrix.roles.map((role) => {
                          const locked = !canConfigure || role.key === "pm";
                          if (locked) return <td key={role.id} className="p-1" />;
                          return (
                            <td key={role.id} className="p-1 text-center">
                              <Select
                                aria-label={`${group.label} 일괄 · ${role.name}`}
                                className="h-7 w-auto py-0 text-xs"
                                disabled={busy}
                                value=""
                                onChange={(e) => bulkSet(role.id, role.name, group, e.target.value)}
                              >
                                <option value="">일괄▾</option>
                                <option value="ALLOW">ALLOW 전체</option>
                                <option value="DENY">DENY 전체</option>
                                <option value="none">해제 전체</option>
                              </Select>
                            </td>
                          );
                        })}
                      </tr>
                      {!isCollapsed && group.permissions.map((p) => (
                        <tr key={p.id} className="border-t border-border">
                          <td className="sticky left-0 z-10 bg-card p-2 pl-6 font-mono">{p.resource}:{p.action}</td>
                          {matrix.roles.map((role) => {
                            const cell = byCell.get(ruleKey(role.id, p.id));
                            const effect = (cell?.effect ?? "none") as Effect;
                            const scope = cell?.scope ?? "all";
                            const locked = !canConfigure || role.key === "pm";
                            const scopes = scopeOptions[`${p.resource}:${p.action}`] ?? ["all"];
                            return (
                              <td key={role.id} className="p-1 text-center">
                                {locked
                                  ? <span className="text-muted-foreground">{effect === "none" ? "·" : `${effect}/${scope}`}</span>
                                  : (
                                    <SegmentCell
                                      effect={effect}
                                      scope={scope}
                                      scopes={scopes}
                                      onSet={(eff, sc) => setCell(role.id, p.id, eff, sc)}
                                    />
                                  )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
