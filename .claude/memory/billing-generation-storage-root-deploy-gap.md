---
name: billing-generation-storage-root-deploy-gap
description: 대금청구 문서 생성은 STORAGE_ROOT env(절대경로)+Template/대금청구 HWPX 4종 프로비저닝 필요 — 배포 런북에 빠진 필수 단계(cutover 주의)
metadata: 
  node_type: memory
  type: project
  originSessionId: 994647f2-569b-4257-b82a-fd9176533351
---

대금청구가 **파일 생성을 요구하는 첫 기능**이라, 이전 배포(연차·캘린더)엔 없던 `STORAGE_ROOT` env가 처음 필요해짐. dev(kgs-dev)에서 "문서 생성" 클릭 시 500 발생 → 원인은 코드 버그 아니라 **dev `.env`에 `STORAGE_ROOT` 누락**(`getStorageRoot()`가 fail-closed throw, `mapError`가 도메인 에러 아닌 것 rethrow→500).

문서 생성 성공에 필요한 3가지(모두 fail-closed, 없으면 500):
1. `STORAGE_ROOT`(절대경로) env — dev는 `/home/kgs/apps/ops-hub`(로드맵 결정 #7, `.gitignore`가 out/·Template/·keys/ 무시라 앱 디렉터리 안이어도 안전).
2. `<STORAGE_ROOT>/Template/대금청구/` 아래 HWPX 4종(공문·기성계·점검표1·점검표2). **레포 `tests/golden/billing/templates/대금청구/`에 git 추적**돼 있어 서버 내 복사로 프로비저닝 가능.
3. 해당 projectYear `BillingConfig` + 회차일(`computeBillingPeriod`: 전월=회차, 전월 연도=projectYear. 1월분=전년 12회차).

**cutover/배포 런북 필수 추가**: 대금청구 사용하려면 STORAGE_ROOT 설정 + Template 프로비저닝 + config 시드가 배포 단계에 포함돼야 함(현 CLAUDE.md 배포 절차엔 없음). dev 조치: `.env`에 STORAGE_ROOT 추가(백업 `.env.bak-pre-storage-root`), 템플릿 복사, `pm2 restart`(STORAGE_ROOT는 런타임 읽기 → 재빌드 불필요). 관련: [[ops-hub-cutover-target]]
