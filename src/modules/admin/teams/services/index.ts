import "server-only";
import { requirePermission } from "@/kernel/access";
import { listTeams, createTeam, updateTeam, type TeamRow } from "../repositories";
import type { CreateTeamInput, UpdateTeamInput } from "../validations";

export { listActiveUsersWithTeam } from "../repositories";

const RESOURCE = "admin.teams";

export function listTeamsForAdmin(): Promise<TeamRow[]> {
  return listTeams();
}

export async function createTeamAsAdmin(actorId: string, input: CreateTeamInput): Promise<{ id: string }> {
  await requirePermission(actorId, RESOURCE, "configure");
  return createTeam(input.name, actorId);
}

export async function updateTeamAsAdmin(
  actorId: string, id: string, patch: UpdateTeamInput, expectedUpdatedAt: Date,
): Promise<void> {
  await requirePermission(actorId, RESOURCE, "configure");
  await updateTeam(id, patch, expectedUpdatedAt, actorId);
}
