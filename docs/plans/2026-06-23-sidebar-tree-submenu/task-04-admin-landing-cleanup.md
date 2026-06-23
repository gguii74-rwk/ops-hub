# Task 04 — 관리 랜딩 정리(AdminLinks 제거)

사용자 관리가 사이드바 트리(task-01)로 들어왔으므로 `/admin` 랜딩의 중복 링크 목록 `AdminLinks`를 제거한다. 단 `/admin` 페이지·제목(h1)은 유지한다(부모 `관리`가 `/admin` 링크라 페이지 존속, 제목 회귀 방지).

## Files

- Modify: `src/app/(app)/admin/page.tsx` — `AdminLinks` import·사용 제거, 안내 문구로 대체
- Delete(git rm): `src/app/(app)/admin/admin-links.tsx`

## Prep

- spec D11(③ `/admin` 랜딩 `AdminLinks` 정리, 최소 랜딩 유지).
- 확인된 사실: `AdminLinks`는 `src/app/(app)/admin/page.tsx`에서만 import(src 기준 유일). 테스트 import 없음.
- **메모리 주의(중요):** admin 셸 리팩터(`admin-links 삭제 + /admin 리다이렉트 + h1 제거`)는 `admin-tabs` 작업과 묶인 별도 DEFERRED 건이며 "단독 적용 시 admin 페이지 제목 회귀"로 기록됨. 본 태스크는 **링크 목록만 제거하고 h1·페이지는 유지** → 회귀 없음. `/admin` 리다이렉트·h1 제거는 **본 태스크 범위 밖**.

## Deps

없음. (task-03 이후 마지막에 두면 admin 정리가 깔끔히 닫힘.)

## Steps

### 1. 다른 import처 없음 재확인

```bash
grep -rn "admin-links\|AdminLinks" src tests
```
→ `src/app/(app)/admin/page.tsx`와 `admin-links.tsx` 자신 외 결과 없음을 확인(있으면 중단·재검토).

### 2. admin/page.tsx 정리

`src/app/(app)/admin/page.tsx` 전체를 아래로 교체:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "admin.users", "view"))) {
    redirect("/dashboard");
  }
  return (
    <section className="grid gap-4">
      <h1 className="text-xl font-semibold">관리</h1>
      <p className="text-sm text-muted-foreground">좌측 메뉴에서 사용자 관리·메뉴 관리를 선택하세요.</p>
    </section>
  );
}
```

(서버 가드 — `auth`/`hasPermission(admin.users, view)` redirect — 는 그대로 유지. `AdminLinks` import 줄만 사라짐.)

### 3. admin-links.tsx 삭제

```bash
git rm "src/app/(app)/admin/admin-links.tsx"
```

### 4. 검증

```
npm run typecheck
npm run lint
npm test
npm run build
```

### 5. 커밋

```bash
git add "src/app/(app)/admin/page.tsx" "src/app/(app)/admin/admin-links.tsx"
git commit -m "chore(admin): /admin 랜딩의 중복 AdminLinks 제거(사용자 관리는 사이드바 트리로)"
```

(`git rm`한 파일도 명시 stage에 포함 — 삭제가 커밋에 반영됨.)

## Acceptance Criteria

```
npm run typecheck   # 에러 0(orphan import 없음)
npm run lint        # 에러 0
npm test            # 전부 통과
npm run build       # 성공
```

## Cautions

- **h1 `관리`를 제거하지 말 것.** 이유: 메모리에 "단독 h1 제거 시 admin 페이지 제목 회귀" 경고 — 제목 제거·`/admin` 리다이렉트는 admin-tabs와 묶인 별도 DEFERRED 작업.
- **서버 가드를 제거하지 말 것.** 이유: `/admin` 직접 접근 시 권한 없는 사용자를 `/dashboard`로 보내는 fail-closed 동작 유지.
- 사용하지 않게 된 `AdminLinks` import는 **반드시 함께 제거**(내 변경이 만든 orphan) — 안 그러면 lint/typecheck 실패.
