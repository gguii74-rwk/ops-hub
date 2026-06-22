import { z } from "zod";

// D15: newPassword는 정책상 12자+. currentPassword는 선택(자발 변경=필수 검증을 라우트가 수행, 강제 변경=임시 비번 확인).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(12),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
