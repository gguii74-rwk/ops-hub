#!/usr/bin/env python3.11
"""annual-leave 운영 SQLite에서 연차 데이터를 읽어 JSON으로 stdout 출력 (읽기 전용).

대상: ops-hub 연차 데이터 적재 스크립트(scripts/migrate-al-leave.ts)의 입력.
출력 = { usersIdEmail, allocations, requests, history }.
  - usersIdEmail: 소스 userId(uuid) → email 매핑 다리만(비번 등 민감정보 미포함).
경로는 kgs-dev 서버 운영 DB에 맞춰 하드코딩. root 소유라 `sudo python3.11`로 실행.
설계·매핑 규칙: docs/migration/2026-06-25-annual-leave-data.md
"""
import json
import sqlite3
import sys

DB = "/opt/annual-leave/backend/prisma/database.sqlite"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # 읽기 전용 — 운영 영향 0
con.row_factory = sqlite3.Row


def rows(sql):
    return [dict(r) for r in con.execute(sql).fetchall()]


users = rows("SELECT id, email FROM users")
allocations = rows(
    "SELECT id, userId, year, allocatedDays, carriedOverDays, "
    "carriedOverExpiryDate, usedDays FROM leave_allocations"
)
requests = rows(
    "SELECT id, userId, leaveType, leaveSubType, quarterStartTime, startDate, endDate, "
    "days, reason, status, appliedAt, reviewedBy, reviewedAt, rejectionReason, "
    "cancelledAt, cancellationReason, isCarriedOver, createdAt, "
    "createdByAdminId, createdByAdminAt, modifiedByAdminId, modifiedByAdminAt, "
    "adminActionNote FROM leave_requests"
)
history = rows(
    "SELECT id, allocationId, userId, changeType, changeDays, reason, reasonDetail, "
    "beforeDays, afterDays, createdBy, createdAt FROM leave_allocation_history"
)
con.close()

json.dump(
    {
        "usersIdEmail": users,
        "allocations": allocations,
        "requests": requests,
        "history": history,
    },
    sys.stdout,
    ensure_ascii=False,
    indent=2,
)
print(file=sys.stderr)
print(
    f"exported users={len(users)} allocations={len(allocations)} "
    f"requests={len(requests)} history={len(history)}",
    file=sys.stderr,
)
