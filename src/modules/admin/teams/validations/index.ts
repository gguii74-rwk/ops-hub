import { z } from "zod";
import { expectedUpdatedAt } from "@/kernel/optimistic";

const teamName = z.string().trim().min(1, "팀 이름은 필수입니다.").max(100);

export const createTeamSchema = z.object({ name: teamName });

// 부분 patch — 이름/active/팀장 중 보낸 것만. leadUserId=null은 "팀장 해제".
export const updateTeamSchema = z.object({
  name: teamName.optional(),
  active: z.boolean().optional(),
  leadUserId: z.string().min(1).nullish(), // null 허용(해제), undefined면 미변경
});
export const updateTeamBodySchema = updateTeamSchema.extend({ updatedAt: expectedUpdatedAt });

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
