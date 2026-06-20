# Task 01 — Holiday 스키마·마이그레이션

**Purpose:** 날짜로 조회 가능한 영속 공휴일 저장소(`Holiday`)를 신설한다. 채움(공공데이터 sync)은 task 02. 이 테이블이 ANNUAL 일수 계산(공휴일 제외)의 결정적 출처.

## Files
- Modify: `prisma/schema.prisma` (`Holiday` 모델 추가)
- Create: `prisma/migrations/<timestamp>_add_holiday/migration.sql` (`prisma migrate dev`가 생성)

## Prep
- spec §4.1 / entrypoint §SC-1.
- 마이그레이션 적용엔 DB 필요. `npm run prisma:validate`는 DB 없이 가능.

## Deps
없음.

## Steps

### 1. 스키마에 Holiday 추가
`prisma/schema.prisma`의 `@@schema("kernel")` 모델 그룹에 추가:

```prisma
model Holiday {
  date      DateTime @id @db.Date
  name      String
  year      Int
  createdAt DateTime @default(now())

  @@index([year])
  @@schema("kernel")
}
```

검증:
```
npm run prisma:validate   # expect: 스키마 유효
```

### 2. 마이그레이션 생성·적용 (DB 필요)
```
npm run prisma:migrate    # prisma migrate dev — add_holiday 생성·적용
npm run prisma:generate   # Prisma Client 재생성(Holiday 타입 노출)
```

DB 없을 때는 `npm run prisma:validate` + `npm run prisma:generate`로 타입만 확인하고, 마이그레이션 적용은 DB 연결 후 수행한다.

### 3. 커밋
```
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(leave): Holiday 영속 테이블·마이그레이션"
```

## Acceptance Criteria
- `npm run prisma:validate` → 스키마 유효.
- `npm run prisma:generate` → 성공, `prisma.holiday` 타입 사용 가능.
- `npm run typecheck` → 그린.

## Cautions
- **Don't `@db.Date` 없이 `DateTime`만 쓰지 말 것.** Reason: 시각·TZ 잡음이 날짜 키(`YYYY-MM-DD`) 비교를 흔든다 — date-only 필수.
- **Don't 정적 공휴일 데이터를 여기에 넣지 말 것.** Reason: 채움은 task 02의 공공데이터 sync 책임(단일 출처). 이 태스크는 스키마만.
- **Don't 기존 LeaveRequest/LeaveAllocation/History를 변경하지 말 것.** Reason: Phase 1 선반영, 파괴적 마이그레이션 회피(spec §4).
