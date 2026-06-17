import { auth } from "@/lib/auth";
import { issueClaims, type Identity } from "@/lib/auth/federation/claims";

export { issueClaims, toGroups } from "@/lib/auth/federation/claims";
export type { Identity } from "@/lib/auth/federation/claims";

/** ops-hub 세션이 유효하면 외부용 Identity, 아니면 null. */
export async function verifySession(): Promise<Identity | null> {
  const session = await auth();
  if (!session?.user) return null;
  return issueClaims(session.user);
}
