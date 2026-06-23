"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Matrix {
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: Array<{ id: string; resource: string; action: string }>;
  rules: Array<{ roleId: string; permissionId: string; effect: "ALLOW" | "DENY"; scope: string }>;
}

export function MatrixEditor({ matrix, scopeOptions, canConfigure }: { matrix: Matrix; scopeOptions: Record<string, string[]>; canConfigure: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const ruleKey = (r: string, p: string) => `${r}:${p}`;
  const byCell = new Map(matrix.rules.map((x) => [ruleKey(x.roleId, x.permissionId), x]));

  async function setCell(roleId: string, permissionId: string, effect: string, scope: string) {
    setErr(null);
    const res = await fetch(`/api/admin/roles/${roleId}/permissions/${permissionId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effect, scope }),
    });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "오류"); return; }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">권한 매트릭스</h1>
      {!canConfigure && <p className="text-sm text-muted-foreground">읽기 전용 — 편집은 OWNER만 가능합니다.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr><th className="sticky left-0 bg-background p-2 text-left">권한</th>
              {matrix.roles.map((r) => <th key={r.id} className="p-2">{r.name}</th>)}</tr>
          </thead>
          <tbody>
            {matrix.permissions.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="sticky left-0 bg-background p-2 font-mono">{p.resource}:{p.action}</td>
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
