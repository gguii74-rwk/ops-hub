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
