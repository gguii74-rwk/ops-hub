import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "./_components/signup-form";

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="mx-auto mt-[8vh] w-full max-w-sm px-6">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="font-display text-3xl font-semibold tracking-tight">ops-hub</span>
        <span className="h-1 w-10 rounded-full bg-brand" aria-hidden />
        <p className="text-sm text-muted-foreground">내부 업무 운영 허브</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>가입 신청</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupForm />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            이미 계정이 있으신가요?{" "}
            <Link href="/login" className="underline underline-offset-4 hover:text-foreground">로그인</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
