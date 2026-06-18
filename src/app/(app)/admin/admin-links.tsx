"use client";

import { useCan } from "@/lib/auth/permissions-client";

export function AdminLinks() {
  const canAudit = useCan("admin.audit", "view");
  const canUsers = useCan("admin.users", "view");
  return (
    <ul className="grid gap-1 text-sm text-muted-foreground">
      {canUsers ? <li>사용자</li> : null}
      {canAudit ? <li>감사 로그</li> : null}
    </ul>
  );
}
