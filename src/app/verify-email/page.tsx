import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "./_components/set-password-form";

export default function VerifyEmailPage() {
  return (
    <main className="mx-auto mt-[8vh] w-full max-w-sm px-6">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="font-display text-3xl font-semibold tracking-tight">ops-hub</span>
        <span className="h-1 w-10 rounded-full bg-brand" aria-hidden />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>이메일 인증 · 비밀번호 설정</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">확인 중…</p>}>
            <SetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
