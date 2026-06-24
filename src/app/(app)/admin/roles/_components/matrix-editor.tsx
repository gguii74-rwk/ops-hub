"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { groupPermissions, type GroupDef } from "./grouping";

interface Matrix {
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: Array<{ id: string; resource: string; action: string }>;
  rules: Array<{ roleId: string; permissionId: string; effect: "ALLOW" | "DENY"; scope: string }>;
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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">권한 매트릭스</h1>
      {!canConfigure && <p className="text-sm text-muted-foreground">읽기 전용 — 편집은 OWNER만 가능합니다.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-background p-2 text-left">권한</th>
              {matrix.roles.map((r) => <th key={r.id} className="p-2">{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => {
              const isCollapsed = !!collapsed[group.key];
              return (
                <Fragment key={group.key}>
                  <tr className="border-t bg-muted/40">
                    <td className="sticky left-0 bg-muted/40 p-1">
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
                          <select
                            aria-label={`${group.label} 일괄 · ${role.name}`}
                            disabled={busy}
                            defaultValue=""
                            onChange={(e) => { const v = e.target.value; e.target.value = ""; bulkSet(role.id, role.name, group, v); }}
                          >
                            <option value="">일괄▾</option>
                            <option value="ALLOW">ALLOW 전체</option>
                            <option value="DENY">DENY 전체</option>
                            <option value="none">해제 전체</option>
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                  {!isCollapsed && group.permissions.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="sticky left-0 bg-background p-2 pl-6 font-mono">{p.resource}:{p.action}</td>
                      {matrix.roles.map((role) => {
                        const cell = byCell.get(ruleKey(role.id, p.id));
                        const effect = cell?.effect ?? "none";
                        const scope = cell?.scope ?? "all";
                        const locked = !canConfigure || role.key === "pm";
                        const scopes = scopeOptions[`${p.resource}:${p.action}`] ?? ["all"];
                        return (
                          <td key={role.id} className="p-1 text-center">
                            {locked
                              ? <span>{effect === "none" ? "·" : `${effect}/${scope}`}</span>
                              : (
                                <div className="flex gap-1 justify-center">
                                  <select value={effect} onChange={(e) => setCell(role.id, p.id, e.target.value, e.target.value === "ALLOW" ? scope : "all")}>
                                    <option value="none">·</option><option value="ALLOW">ALLOW</option><option value="DENY">DENY</option>
                                  </select>
                                  {effect === "ALLOW" && scopes.length > 1 && (
                                    <select value={scope} onChange={(e) => setCell(role.id, p.id, "ALLOW", e.target.value)}>
                                      {scopes.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  )}
                                </div>
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
    </div>
  );
}
