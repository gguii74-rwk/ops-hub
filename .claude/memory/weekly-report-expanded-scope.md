---
name: weekly-report-expanded-scope
description: 주간보고 sub-project는 day-sync 단순 포팅이 아니라 다중 직무 보고 시스템으로 확장됨 — 사무실에서 본격 설계 예정
metadata: 
  node_type: memory
  type: project
  originSessionId: 8ad895d6-1d32-488c-8402-2b1ba629fdce
---

Phase 4 주간보고 sub-project는 brainstorming 중 범위가 크게 확장됨. day-sync XLSX 1종 포팅이 아니라 다음 통합 시스템:

- **기존 PM 주간보고(유지)**: PM(사용자)이 운영팀 개발자들의 주간보고를 취합해 본부/본사에 보고하는 XLSX (day-sync `generate.service.ts`/`excel-generator.ts`/`google-sheets.ts`/`report-formatter.ts` 계승).
- **신규**: 개발자·컨텐츠팀·민원응대팀의 **주간/월간 보고서를 양식 고정 한글(HWP/HWPX) 문서로 자동 생성**. access-control `jobFunction`(PM/DEVELOPER/CONTENT_MANAGER/CIVIL_RESPONSE)과 직접 대응.

확정된 설계 방향(brainstorming 응답):
- 입력 소스 = **하이브리드**: 팀원이 ops-hub 앱 내 폼으로 입력 → 그 DB 데이터로 HWP 생성 + PM XLSX 취합도 같은 DB에서(Google Sheets 탈피).
- 보고 단위 = **개인별 제출, 취합은 수동**: 개인이 입력하되 PM이 XLSX 생성·편집 시 미리보기에서 취합 내용을 손으로 조정(day-sync 미리보기 편집 계승). 자동 취합 아님.

**상태**: 복잡도가 커서 사무실(OMEN)에서 본격 설계 예정. day-sync 원본 키 파일: `src/lib/{excel-generator,google-sheets,report-formatter}.ts`, `src/services/{generate,deliverable}.service.ts`, `src/types/task.ts`. day-sync는 단일 사업(행정안전부 안전신문고)에 팀원 7명·셀 좌표·산출물 라벨·번역건수까지 하드코딩. 신규는 HWPX 템플릿 채우기(대금청구/알림톡 sub-project와 기술 공유). 관련: [[session-per-merge-workflow]]
