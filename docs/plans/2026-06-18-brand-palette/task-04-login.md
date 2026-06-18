# task-04 — login 리터치 (워드마크 + 브랜드 액센트)

**목적:** 로그인 화면에 Playfair 워드마크와 가벼운 브랜드 액센트를 더한다. 틴트 표면(`bg-page`) 위 카드 구조는 유지. **로그인 로직(server action `signIn`, 에러 처리)은 무변경.**

## Files

- **Modify:** `src/app/login/page.tsx` — 워드마크 헤더 + 브랜드 액센트 추가, CardTitle 문구 조정

## Prep

- spec §7(파일 변경: login)
- 엔트리포인트 §Shared Contracts "폰트", "소프트 배경 패턴"
- 현재 `src/app/login/page.tsx`(server, `login` action + Card/Input/Label/Button 폼)

## Deps

01(`bg-brand` 토큰), 02(`font-display`). (`bg-brand` 미존재 시 빌드는 통과하나 액센트 바 색이 비므로 01을 hard dep로 둔다.)

## Steps (프레젠테이션 — 자동 테스트 없음, 게이트 + 스모크로 검증)

### 1. login/page.tsx 리터치

`src/app/login/page.tsx`를 다음으로 만든다. 변경점은 ①Card 위에 Playfair 워드마크 + 브랜드 액센트 바 추가, ②CardTitle "ops-hub 로그인" → "로그인"(워드마크가 이미 ops-hub 표시). **server action `login`과 `auth`/`redirect`/에러 분기는 한 글자도 바꾸지 않는다.**

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
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="font-display text-3xl font-semibold tracking-tight">ops-hub</span>
        <span className="h-1 w-10 rounded-full bg-brand" aria-hidden />
        <p className="text-sm text-muted-foreground">내부 업무 운영 허브</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>로그인</CardTitle>
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

### 2. 게이트 + 스모크

```bash
npm run typecheck
npm run lint
npm run build
```

수동 스모크(로그아웃 상태에서 `/login`): 워드마크 `ops-hub`가 Playfair로 렌더, 그 아래 라벤더(`bg-brand`) 액센트 바, 카드 제목 "로그인", 잘못된 자격증명 시 빨간 에러 문구 그대로 동작.

### 3. 커밋

```bash
git add src/app/login/page.tsx
git commit -m "Retouch login with Playfair wordmark and brand accent"
```

## Acceptance Criteria

```bash
npm run typecheck   # 에러 없음
npm run lint        # 에러 없음
npm run build       # 성공
npm test            # 회귀 없음
```

- 워드마크 `<span className="font-display ...">ops-hub</span>` + `bg-brand` 액센트 바 존재.
- `login` server action·`AuthError` 분기·`autoComplete` 속성이 원본과 동일.

## Cautions

- **server action `login`/`auth`/`redirect`/에러 분기를 수정하지 말 것.** 이유: 인증 동작 변경은 이 패스 범위 밖(순수 리터치). 회귀 위험.
- **파스텔을 텍스트색으로 쓰지 말 것.** 이유: `bg-brand`는 fill(액센트 바)로만. 워드마크 텍스트는 `text-foreground` 기본 유지(spec §8 — 파스텔 텍스트 금지).
