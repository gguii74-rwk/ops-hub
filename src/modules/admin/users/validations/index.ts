import { z } from "zod";
import { expectedUpdatedAt } from "@/kernel/optimistic";

// 비밀번호 정책(시드 정책 재사용): 12자 이상.
const password = z.string().min(12, "비밀번호는 12자 이상이어야 합니다.");

// 신청·편집에 쓰는 속성 enum(schema.prisma와 일치).
const employmentType = z.enum(["REGULAR", "CONTRACTOR"]);
const jobFunction = z.enum(["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"]);
const systemRole = z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER"]);
const overrideEffect = z.enum(["ALLOW", "DENY"]);
const overrideScope = z.enum(["own", "team", "assigned", "all"]);

const email = z.string().email("올바른 이메일 형식이 아닙니다.");
const name = z.string().trim().min(1, "이름은 필수입니다.").max(100);
const teamId = z.string().min(1).nullish(); // 팀 배정(관리자 확정). null=무소속, undefined=미변경
// 토큰·datetime은 문자열로 받고(라우트가 Date로 파싱), 빈 문자열은 거부.
const isoDateTime = z.string().datetime({ offset: true }).nullish();

// 공개 자가가입(signupSchema)·set-password(setPasswordSchema)·재발송(resendSchema)은 task-06 `validations/signup.ts`,
// 비번 변경(changePasswordSchema)은 task-07 `validations/change-password.ts` 소관 — 본 파일에 정의 금지(중복 정의 충돌).

// ── 관리자 직접추가(D4): 임시비번 + 확정 속성·역할. ──
export const adminCreateSchema = z.object({
  email, name, password,
  employmentType, jobFunction, teamId,
  systemRole,
  roleKeys: z.array(z.string()).default([]),
});

// ── 승인(확정): 고용형태·직무·systemRole·역할 확정. roleKeys 빈 배열 허용. ──
// NF2: name·department는 선택(기존 호출 호환). 승인이 프로필 권위 — admin 입력값이 사용자 self-input을 덮어쓴다.
export const approveSchema = z.object({
  employmentType, jobFunction, systemRole,
  roleKeys: z.array(z.string()).default([]),
  name: name.optional(),
  teamId: teamId,
});

// ── 거절: 사유 필수(trim 후 비어있으면 거부). ──
export const rejectSchema = z.object({
  reason: z.string().trim().min(1, "거절 사유는 필수입니다.").max(500),
});

// ── 편집(부분 patch): 전부 선택. systemRole 가드는 서비스가 강제(D12). ──
export const updateUserSchema = z.object({
  name: name.optional(),
  teamId,
  employmentType: employmentType.optional(),
  jobFunction: jobFunction.optional(),
  systemRole: systemRole.optional(),
});

// ── 역할 집합 확정. ──
export const rolesSchema = z.object({
  roleKeys: z.array(z.string()),
});

// ── 개인 override: 권한키(resource:action)·effect·scope·사유·유효기간. ──
export const overrideSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  effect: overrideEffect,
  scope: overrideScope,
  reason: z.string().trim().max(500).nullish(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
});

// ── 낙관적 동시성 body 스키마(stale-tab lost-update 차단). ──
// 도메인 스키마는 그대로 두고, 라우트가 파싱하는 body 스키마만 extend로 분리한다(updatedAt = 클라가 본 행 버전).
// 라우트가 updatedAt을 추출해 parseExpectedUpdatedAt으로 Date 변환 후 service에 별도 인자로 넘긴다.
export const updateUserBodySchema = updateUserSchema.extend({ updatedAt: expectedUpdatedAt });
export const approveBodySchema = approveSchema.extend({ updatedAt: expectedUpdatedAt });
export const rolesBodySchema = rolesSchema.extend({ updatedAt: expectedUpdatedAt });

export type AdminCreateInput = z.infer<typeof adminCreateSchema>;
export type ApproveInput = z.infer<typeof approveSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type OverrideInputDto = z.infer<typeof overrideSchema>;
