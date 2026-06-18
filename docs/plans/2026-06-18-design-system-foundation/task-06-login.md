# Task 06 — login 마이그레이션

`src/app/login/page.tsx`의 인라인 폼을 Card + Input + Label + Button으로 교체한다. server action 로그인 로직은 유지한다.

## Files
- Modify: `src/app/login/page.tsx`

## Prep
- 스펙 §8
- 엔트리포인트 §Shared Contracts: Card, Input, Label, Button
- 현재 파일의 `login` server action(`signIn`/`AuthError`/`redirect`)과 `auth()` 가드, `searchParams` 처리는 **그대로 유지**하고 마크업만 교체한다.

## Deps
- task-02 (Input, Label, Button)
- task-03 (Card)

## Steps

### 1. login/page.tsx 교체
파일 전체를 다음으로 교체한다.
```tsx
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/dashboard",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=invalid");
      }
      throw err; // NEXT_REDIRECT 등은 그대로 던져 Next가 처리
    }
  }

  return (
    <main className="mx-auto mt-[10vh] w-full max-w-sm px-6">
      <Card>
        <CardHeader>
          <CardTitle>ops-hub 로그인</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="mb-3 text-sm text-destructive">
              이메일 또는 비밀번호가 올바르지 않습니다.
            </p>
          ) : null}
          <form action={login} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit">로그인</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

### 2. 검증 + 커밋
```
npm run lint
npm run typecheck
npm run build
git add src/app/login/page.tsx
git commit -m "Migrate login page to design system primitives"
```

## Acceptance Criteria
- `npm run lint` → 0 errors
- `npm run typecheck` → 0 errors
- `npm run build` → 성공
- `npm test` → 기존 테스트 회귀 없음
- 수동 스모크(dev 서버): `/login`에서 admin 계정으로 로그인 → `/dashboard` 리다이렉트. 틀린 비밀번호 → 빨간 에러 문구 표시.

## Cautions
- **`login` server action의 `throw err`(NEXT_REDIRECT 재던지기)를 제거하지 말 것.** Reason: `redirectTo` 성공 시 Next가 던지는 redirect 신호를 삼키면 로그인 후 이동이 깨진다. `AuthError`만 잡아 `/login?error=invalid`로 보낸다.
- **`<label htmlFor>`와 `<Input id>`를 짝지을 것.** Reason: 접근성(클릭으로 포커스) 유지.
