import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";

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
    <main style={{ maxWidth: 360, margin: "10vh auto", padding: 24 }}>
      <h1>ops-hub 로그인</h1>
      {error ? (
        <p style={{ color: "#b91c1c" }}>이메일 또는 비밀번호가 올바르지 않습니다.</p>
      ) : null}
      <form action={login} style={{ display: "grid", gap: 12 }}>
        <label>
          이메일
          <input name="email" type="email" required autoComplete="username" style={{ width: "100%" }} />
        </label>
        <label>
          비밀번호
          <input name="password" type="password" required autoComplete="current-password" style={{ width: "100%" }} />
        </label>
        <button type="submit">로그인</button>
      </form>
    </main>
  );
}
