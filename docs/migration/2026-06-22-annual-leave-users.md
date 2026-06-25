# annual-leave 사용자 마이그레이션 (2026-06-22)

`docs/migration/initial-migration-plan.md` §4의 User 부분을 실제 데이터로 구체화한 1회성 마이그레이션 기록.

## 출처 · 대상 · 범위

- **출처**: kgs-dev 운영 annual-leave SQLite `/opt/annual-leave/backend/prisma/database.sqlite` (읽기 전용). 로컬 repo의 `prisma/prisma/database.sqlite`는 빈 개발 DB이므로 사용하지 않음.
- **대상**: kgs-dev `:5433` PostgreSQL `opshub` (dev/테스트). 운영 cutover는 별도.
- **범위**: `User`만. `LeaveAllocation`/`History`/`Request`는 이번 범위 아님(id 매핑 불필요 → 새 cuid 발급).

## 원본 데이터 (18명)

| department | 인원 | 비고 |
| --- | --- | --- |
| 개발팀 | 3 | 외주(naver/gmail) |
| 컨텐츠팀 | 3 | 외주(naver) |
| 민원응대팀 | 5 | 외주(naver/gmail), 1명 비활성 |
| 관리자 | 7 | 정직원(uracle.co.kr) — 본인·PL·개발자4·퇴사자1 |

- 비밀번호 해시 전부 `$2b$10$` (bcrypt cost 10) = ops-hub와 동일 → **해시 그대로 이전**, 재로그인 가능.
- accountStatus 전부 `APPROVED`. isActive: 활성 12 / 비활성 6.

## 매핑 규칙

| ops-hub 필드 | 규칙 |
| --- | --- |
| `id` | 새 cuid |
| `email` | 소문자화(병합 키) |
| `passwordHash` | 원본 `password` 그대로 |
| `name`·`department`·`position`·`joinDate` | 그대로 |
| `employmentType` | email `@uracle.co.kr` → `REGULAR`, 그 외 → `CONTRACTOR` |
| `jobFunction` | department: 개발팀·관리자→`DEVELOPER`, 컨텐츠팀→`CONTENT_MANAGER`, 민원응대팀→`CIVIL_RESPONSE` |
| `systemRole` | 원본 role `ADMIN`→`ADMIN`, `EMPLOYEE`→`MEMBER` |
| `status` | isActive→`ACTIVE`, 비활성→`DISABLED` |
| `emailVerifiedAt` | 마이그레이션 시각(운영 중 검증된 계정) |
| `mustChangePassword` | `false` |
| AccessRole(`roleKeys`) | `REGULAR/DEVELOPER`→`regular-developer`, `CONTRACTOR/DEVELOPER`→`contractor-developer`, `CONTRACTOR/CONTENT_MANAGER`→`contractor-content`, `CONTRACTOR/CIVIL_RESPONSE`→`contractor-civil-response`. 원본 role `ADMIN`이면 `admin` 추가. |

### 개별 결정 (사용자 확정)

- **ggui74@uracle.co.kr (본인, PM/총관리자)**: ops-hub OWNER로 **이미 존재**(seed OWNER 이메일을 `admin@uracle.co.kr`→`ggui74@uracle.co.kr`로 변경). 마이그레이션은 **제외**(비파괴 skip).
- **kimkfc@uracle.co.kr (김형중, 개발팀 PL)**: REGULAR/DEVELOPER + `admin`(위임 사용자관리자), systemRole `ADMIN`.
- **관리자 부서 개발자 4명**(김재훈·김정현·연순모·김영건): REGULAR/DEVELOPER, 비활성→`DISABLED`.
- **이병규(hatecoding@uracle.co.kr)**: 퇴사자 → **제외**.

→ 적재 대상 **16명** (18 − ggui74 − 이병규).

## 실행 절차 (서버)

```bash
# 1. 원본 export (root 소유 SQLite → kgs 소유 JSON, 비번 해시 포함이라 600)
sudo python3.11 scripts/migrate-al-users-export.py > ~/al-users.json && chmod 600 ~/al-users.json
# 2. dry-run (DB 미변경, 매핑 결과만)
cd /home/kgs/apps/ops-hub && npx tsx scripts/migrate-al-users.ts ~/al-users.json --dry-run
# 3. 적재
npx tsx scripts/migrate-al-users.ts ~/al-users.json
# 4. 정리
rm ~/al-users.json
```

- 적재는 **create-only**: email이 이미 있으면 skip(기존 OWNER·재실행 안전). 매핑 수정 재반영은 수동.
- `DATABASE_URL`이 `/opshub`를 가리키지 않으면 스크립트가 중단(safety_report 등 오적재 방지).

## 검증 항목

- 적재 16, skip(ggui74) 1, 제외(이병규) 1.
- 적재 16명 systemRole: ADMIN 1(kimkfc) / MEMBER 15. (기존 OWNER ggui74 포함 시 opshub 전체 OWNER 1 / ADMIN 1 / MEMBER 15)
- 적재 16명 status: ACTIVE 11 / DISABLED 5.
- 각 사용자 roleKeys가 매핑표와 일치.
- 임의 사용자로 기존 비밀번호 로그인.
