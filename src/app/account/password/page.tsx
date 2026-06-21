import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChangePasswordForm } from "./_components/change-password-form";

export default async function AccountPasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const mustChange = session.user.mustChangePassword;

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="mx-auto mt-[8vh] w-full max-w-sm px-6">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="font-display text-3xl font-semibold tracking-tight">ops-hub</span>
        <span className="h-1 w-10 rounded-full bg-brand" aria-hidden />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
        </CardHeader>
        <CardContent>
          {mustChange ? (
            <p className="mb-3 text-sm text-muted-foreground">
              임시 비밀번호로 로그인했습니다. 계속하려면 비밀번호를 변경하세요.
            </p>
          ) : null}
          <ChangePasswordForm mustChange={mustChange} />
          <form action={logout} className="mt-4">
            <Button type="submit" variant="ghost" size="sm" className="w-full">로그아웃</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
