#!/usr/bin/env python3.11
"""annual-leave 운영 SQLite에서 users를 읽어 JSON 배열로 stdout 출력 (읽기 전용).

대상: ops-hub 사용자 마이그레이션 적재 스크립트(scripts/migrate-al-users.ts)의 입력.
출력에 bcrypt 비밀번호 해시가 포함되므로 결과 파일은 600 권한 + 적재 후 삭제할 것.
경로는 kgs-dev 서버 운영 DB에 맞춰 하드코딩. root 소유라 `sudo python3.11`로 실행.
"""
import json
import sqlite3
import sys

DB = "/opt/annual-leave/backend/prisma/database.sqlite"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # 읽기 전용 — 운영 영향 0
con.row_factory = sqlite3.Row
rows = con.execute(
    "SELECT email, password, name, department, position, joinDate, role, isActive, accountStatus FROM users"
).fetchall()
con.close()

out = []
for r in rows:
    out.append({
        "email": r["email"],
        "password": r["password"],
        "name": r["name"],
        "department": r["department"],
        "position": r["position"],
        "joinDate": r["joinDate"],
        "role": r["role"],
        "isActive": bool(r["isActive"]),
        "accountStatus": r["accountStatus"],
    })

json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
print(file=sys.stderr)
print(f"exported {len(out)} users", file=sys.stderr)
