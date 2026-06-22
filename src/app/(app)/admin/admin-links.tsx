"use client";

import Link from "next/link";
import { useCan } from "@/lib/auth/permissions-client";

export function AdminLinks() {
  const canAudit = useCan("admin.audit", "view");
  const canUsers = useCan("admin.users", "view");
  return (
    <ul className="grid gap-1 text-sm text-muted-foreground">
      {canUsers ? <li><Link href="/admin/users" className="hover:text-foreground">사용자</Link></li> : null}
      {canAudit ? <li>감사 로그</li> : null}
    </ul>
  );
}
