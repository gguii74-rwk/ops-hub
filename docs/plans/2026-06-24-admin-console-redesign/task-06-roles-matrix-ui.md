# Task 06 — 권한 매트릭스 화면 재디자인 (Aurora)

`matrix-editor.tsx`를 Aurora로 재조립한다: PageHeader(eyebrow "접근 제어") + StatStrip(역할 수·권한 수) + Card{table}. 셀의 native `<select effect>`를 **컬러 세그먼트 토글**(허용=brand / 거부=rose / · =중립)로, 묶음 native `<select>`를 `Select` 프리미티브로 교체. **setCell·bulkSet·grouping·PM 잠금·ROLE_DISPLAY 정렬·scope 셀렉트는 그대로** 둔다.

## Files

- Modify `src/app/(app)/admin/roles/_components/matrix-editor.tsx`

## Prep

- entrypoint §Shared Contracts(프리미티브) + 불변식(매트릭스).
- 현재 `matrix-editor.tsx`(전문): `ruleKey`/`byCell`/`grouped`(groupPermissions)/`collapsed`/`busy`/`setCell`/`bulkSet` — **로직 변경 금지**. 셀 잠금 `locked = !canConfigure || role.key === "pm"`.
- 역할 열은 서버 `getMatrix`가 `ROLE_DISPLAY_ORDER`로 정렬·`role.name`(한글) 제공 — 표시명 재매핑 불필요.
- scope 셀렉트는 `scopeOptions[`${resource}:${action}`]`가 2개 이상일 때만(ALLOW). 유지.

## Deps

01. (Chip 톤맵 task-02 불필요 — 세그먼트는 자체 색.)

## Cautions

- **`setCell(roleId, permissionId, effect, scope)` 호출 시 scope 규칙 보존:** ALLOW가 아니면 `scope="all"`. 현 코드의 `e.target.value === "ALLOW" ? scope : "all"` 분기를 세그먼트에서도 동일 적용. Reason: 서버 `assertCellAllowed`가 DENY/none의 scope를 all로 정규화하지만, 클라도 동일 의미를 보내야 함.
- **PM 열·읽기전용은 텍스트로만**(편집 컨트롤 렌더 금지). 현 `locked` 분기 유지. Reason: D6 pm read-only + 위임 admin read-only.
- **`bulkSet`의 인자·busy 가드 유지.** Select로 바꿔도 `value=""` 고정(선택 후 자동 복귀) + `disabled={busy}`. Reason: 묶음부여 동시성·UX.
- raw `<table>`(sticky 첫 열·group colspan) 구조는 유지 — Table 프리미티브로 바꾸지 말 것. Reason: sticky/colspan 미지원, 회귀 위험.
- 새 순수 로직 없음 → 단위테스트 추가 없음(grouping/setCell은 기존 테스트). typecheck/lint/build로 검증.

## Steps

### 1. matrix-editor.tsx — 전체 교체

```tsx
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
```

### 2. 검증·커밋

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add "src/app/(app)/admin/roles/_components/matrix-editor.tsx"
git commit -m "feat(admin): 권한 매트릭스 Aurora 재디자인(세그먼트 토글·PageHeader·StatStrip)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 errors
npm test            # green (matrix-getmatrix 등 기존 테스트 무회귀)
npm run build       # 성공
```

수동 확인: eyebrow "접근 제어", 역할/권한 스탯, 그룹 접기/펼치기, 셀 세그먼트(허용=파랑·거부=빨강·· =중립) 클릭 시 즉시 반영, ALLOW + 다중 scope 셀렉트 노출, PM 열·읽기전용은 텍스트, 묶음부여 Select 동작·결과 notice, 동시 편집 시 err 노출.
