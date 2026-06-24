# Task 04 — 매트릭스 UI (접기/펼치기·묶음 셀렉트·요약) + page 연결

**Purpose:** 매트릭스 편집기를 도메인 그룹 헤더행(접기/펼치기) + 그룹×역할 `[일괄▾]` 셀렉트 + 결과 요약으로 리팩터하고, 페이지가 그룹 정의를 props로 내려준다. 개별 셀 편집은 그대로 유지.

## Files

- Modify: `src/app/(app)/admin/roles/page.tsx` — `PERMISSION_GROUPS`를 `groups` prop으로 전달.
- Modify: `src/app/(app)/admin/roles/_components/matrix-editor.tsx` — 그룹화 렌더·접기/펼치기·묶음 셀렉트·요약 메시지.

## Prep

- Spec §D3, §D4, §D5, §D7.
- §Shared Contracts: "그룹화 헬퍼", "묶음 라우트 계약", "MatrixEditor props 변경".
- 현 `matrix-editor.tsx` 전문(이미 read됨) — per-cell 렌더(none/ALLOW/DENY + scope)와 잠금(pm·비-OWNER) 로직을 **그대로** 그룹 내부로 옮긴다.
- 현 `page.tsx`는 `matrix`/`scopeOptions`/`canConfigure`만 전달.

## Deps

- Task 01 (`PERMISSION_GROUPS`), Task 02 (bulk route), Task 03 (`groupPermissions`/`GroupDef`).

## Steps

### 1. 페이지가 그룹 정의 전달 (`src/app/(app)/admin/roles/page.tsx`)

파일 전체를 아래로 교체한다(import 1줄 + groups 계산·전달 추가, 나머지 동일).

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary, allowedScopes } from "@/kernel/access";
import { PERMISSION_GROUPS } from "@/kernel/access/catalog";
import { getRoleMatrix } from "@/modules/admin/roles/services";
import { MatrixEditor } from "./_components/matrix-editor";

export default async function AdminRolesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const summary = await getPermissionSummary(session.user.id);
  const canView = summary.isOwner || summary.keys.includes("admin.roles:view");
  if (!canView) redirect("/dashboard");
  const canConfigure = summary.isOwner; // configure는 OWNER 전용(D7) — 위임 admin은 read-only

  const matrix = await getRoleMatrix();
  // 각 permission의 scopeable 옵션을 서버에서 계산해 내려준다(PD2).
  const scopeOptions: Record<string, string[]> = {};
  for (const p of matrix.permissions) scopeOptions[`${p.resource}:${p.action}`] = allowedScopes(p.resource);
  const groups = PERMISSION_GROUPS.map((g) => ({ key: g.key, label: g.label }));
  return <MatrixEditor matrix={matrix} scopeOptions={scopeOptions} groups={groups} canConfigure={canConfigure} />;
}
```

### 2. 편집기 리팩터 (`src/app/(app)/admin/roles/_components/matrix-editor.tsx`)

파일 전체를 아래로 교체한다.

```tsx
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
```

### 3. 검증

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

### 4. 커밋

```bash
git add "src/app/(app)/admin/roles/page.tsx" "src/app/(app)/admin/roles/_components/matrix-editor.tsx"
git commit -m "feat(roles): 매트릭스 그룹 헤더 접기/펼치기 + 묶음 부여 셀렉트·요약"
```

## Acceptance Criteria

```bash
npm run typecheck                # 통과
npm run lint                     # 통과(boundaries 포함)
npm run build                    # 성공 (bulk 라우트·page 컴파일)
npm test                         # 전체 green
```

- 표(권한 열)가 6개 도메인 그룹 헤더행으로 묶이고, 각 헤더의 `▼/▶`로 그 그룹 권한 행을 접고 펼친다.
- 헤더행의 역할 칸 `[일괄▾]`에서 `ALLOW 전체/DENY 전체/해제 전체` 선택 시 묶음 라우트를 호출하고 결과 요약이 표 상단에 뜬다.
- pm 열·비-OWNER에서는 묶음 셀렉트가 나타나지 않는다(개별 셀도 기존대로 잠금/읽기 전용).
- 개별 셀 편집(none/ALLOW/DENY + scope)은 펼친 상태에서 기존과 동일하게 동작.

## Cautions

- **per-cell 렌더 블록(none/ALLOW/DENY + scope 셀렉트, `locked` 분기)을 바꾸지 말 것. 이유:** 기존 단건 편집 UX·scope 동작을 보존해야 한다 — 그룹 행 안으로 위치만 옮긴다.
- **묶음 셀렉트는 상태가 아니라 액션 트리거다. 이유:** `defaultValue=""`로 두고 `onChange`에서 호출 직후 `e.target.value=""`로 되돌려 같은 동작을 다시 고를 수 있게 한다(controlled value로 만들면 같은 값 재선택이 안 됨).
- **page에서 `@/kernel/access/catalog`를 import해 props로 내려보낼 것(클라이언트가 직접 import하지 않음). 이유:** 그룹 정의는 서버에서 주입하고 클라이언트는 받은 것만 렌더 — 경계를 단방향으로 유지.
