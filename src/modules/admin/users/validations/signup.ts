import { z } from "zod";

const employmentType = z.enum(["REGULAR", "CONTRACTOR"]);
const jobFunction = z.enum(["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"]);

// 자가가입(C안): 비밀번호를 받지 않는다. password 키가 와도 strip(.strict 미사용 — 기본 strip).
export const signupSchema = z.object({
  email: z.string().email("이메일 형식이 아닙니다.").max(255),
  name: z.string().trim().min(1, "이름은 필수입니다.").max(100),
  employmentType,
  jobFunction,
});

// set-password 겸 검증: 토큰 + 새 비밀번호(12자+ 정책 재사용).
export const setPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, "비밀번호는 12자 이상이어야 합니다."),
});

// 검증 메일 재발송: 이메일만.
export const resendSchema = z.object({
  email: z.string().email().max(255),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
