import { z } from "zod";

export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    // NextAuth v5는 AUTH_SECRET을 정식 이름으로 받고, 기존 auth config는 `NEXTAUTH_SECRET ?? AUTH_SECRET`.
    // 둘 다 optional로 두고 아래 refine으로 "둘 중 하나 필수"를 표현(Codex 3차 F4).
    NEXTAUTH_SECRET: z.string().min(1).optional(),
    AUTH_SECRET: z.string().min(1).optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_SECURE: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    LIBREOFFICE_PATH: z.string().optional(),
    TEMPLATE_DIR: z.string().optional(),
    OUTPUT_DIR: z.string().optional(),
  })
  .refine((d) => Boolean(d.NEXTAUTH_SECRET || d.AUTH_SECRET), {
    message: "NEXTAUTH_SECRET or AUTH_SECRET is required",
  });

export type Env = z.infer<typeof envSchema>;
