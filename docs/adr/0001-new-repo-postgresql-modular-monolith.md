# ADR-0001: 신규 저장소와 PostgreSQL 기반 모듈형 모놀리스

## 상태

Accepted

## 배경

`day-sync`와 `annual-leave`는 모두 내부 업무 운영 도구입니다. 두 서비스는 기능은 다르지만 사용자, 권한, 캘린더, 메일, 파일 생성, 관리자 화면이라는 공통 기반을 공유합니다.

반면 기존 구현은 서로 다른 시점의 POC입니다.

- `day-sync`: Next.js 16 단일 앱, Prisma SQLite, NextAuth, Google/SMTP/LibreOffice 연동
- `annual-leave`: Next.js 14 프론트 + Express 백엔드, Prisma SQLite, JWT 인증

기존 코드를 그대로 병합하면 인증, API 스타일, 배포 방식, DB 스키마가 모두 섞입니다.

## 결정

새 저장소 `ops-hub`를 만들고 PostgreSQL 기반의 모듈형 모놀리스로 재설계한다.

- `day-sync`의 애플리케이션 구조를 기준으로 삼는다.
- `annual-leave`의 Express 백엔드와 JWT 구조는 이식하지 않는다.
- 두 POC의 도메인 모델과 검증된 업무 규칙만 포팅한다.
- DB는 PostgreSQL을 사용한다.
- `knowledge-graph-studio`는 별도 서비스로 유지한다.

## 결과

장점:

- 신규 기능을 같은 사용자/권한/운영 모델 위에 추가할 수 있다.
- SQLite 파일 운영과 서비스별 인증 분산을 줄일 수 있다.
- 추후 다른 업무 모듈을 추가해도 마이크로서비스 수를 늘리지 않아도 된다.

비용:

- 초기 재설계와 데이터 마이그레이션 스크립트가 필요하다.
- 기존 두 앱을 즉시 종료할 수 없고 병행 검증 기간이 필요하다.
- PostgreSQL 운영, 백업, 권한 관리가 필요하다.

