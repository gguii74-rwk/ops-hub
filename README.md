# ops-hub

`ops-hub`는 `day-sync`와 `annual-leave`를 재설계해 통합하는 내부 업무 운영 허브입니다.

목표는 두 POC를 물리적으로 합치는 것이 아니라, 공통 사용자/권한/캘린더/파일/메일 기반 위에 업무 자동화와 연차 관리를 모듈로 올리는 것입니다.

## 방향

- `day-sync`의 Next.js App Router, Service/Repository 계층, 문서 생성/메일 발송 경험을 계승한다.
- `annual-leave`의 연차 신청, 승인, 할당, 이력 도메인을 새 스키마로 포팅한다.
- DB는 PostgreSQL을 사용한다.
- `knowledge-graph-studio`는 별도 서비스로 유지한다.

## 초기 모듈

| 모듈 | 출처 | 설명 |
| --- | --- | --- |
| workflows | day-sync | 주간보고, 대금청구, 알림톡 문서 생성 및 메일 발송 |
| leave | annual-leave | 연차 신청, 승인, 할당, 사용 현황, 관리자 캘린더 |
| admin | 신규 공통 | 사용자, 권한, 설정, 감사 로그 |
| integrations | day-sync 중심 | Google APIs, SMTP, LibreOffice, 생성 파일 |

## 주요 문서

- [아키텍처](docs/architecture.md)
- [ADR-0001: 신규 저장소와 PostgreSQL 기반 모듈형 모놀리스](docs/adr/0001-new-repo-postgresql-modular-monolith.md)
- [ADR-0002: 속성 기반 사용자 분류와 역할/권한 테이블](docs/adr/0002-access-control-model.md)
- [권한 설계](docs/architecture/access-control.md)
- [통합 캘린더 설계](docs/architecture/calendar-design.md)
- [마이그레이션 계획](docs/migration/initial-migration-plan.md)
- [day-sync 분석](docs/discovery/day-sync-analysis.md)
- [annual-leave 분석](docs/discovery/annual-leave-analysis.md)
- [knowledge-graph-studio 경계 분석](docs/discovery/knowledge-graph-studio-boundary.md)
- [고도화 로드맵](docs/product/modernization-roadmap.md)
- [Prisma 스키마 초안](prisma/schema.prisma)

## 개발 전제

아직 실행 앱 전체가 스캐폴드된 상태는 아닙니다. 현재 기준선은 도메인 모델과 전환 계획입니다.

```bash
npm install
npm run prisma:validate
```
