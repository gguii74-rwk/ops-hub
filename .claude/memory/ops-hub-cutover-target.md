---
name: ops-hub-cutover-target
description: ops-hub 완성 시 annual-leave가 쓰는 172.21.10.27:3000(방화벽 개방·외주 재택 유일 경로)으로 cutover 예정
metadata: 
  node_type: memory
  type: project
  originSessionId: 6ac35ab6-d0ed-46fe-89cb-c7540e8ff361
---

ops-hub의 최종 배포(cutover) 대상은 현재 annual-leave가 서비스 중인 `http://172.21.10.27:3000/`(개발서버 kgs-dev). 이 IP:포트는 사이트 방화벽에서 개방돼 **외주 인력이 재택근무로 접속하는 현재 유일한 경로**다. ops-hub 완료 시 annual-leave를 이 엔드포인트에서 교체한다.

**Why:** 외주 인력의 접속 가능성이 이 단일 방화벽 경로에 묶여 있다. 캘린더·연차의 실사용자가 바로 이 외주 인력이라, 권한 마스킹과 원격(재택) 성능·캐시가 실사용 조건이다. cutover는 접속 경로 단절 없이 이뤄져야 한다.

**How to apply:** Phase 6 cutover(`docs/migration/initial-migration-plan.md` §7)는 이 엔드포인트 교체를 전제로 설계한다. 연차 데이터는 운영 DB 직접 수정 없이 이메일 병합 키로 신규 PostgreSQL 적재 후 delta 재실행(앞 단계에서 갱신분 무손실). 인프라 상세(IP/포트/방화벽 SSOT)는 workspace-env repo `INVENTORY.md` §1.5 kgs-dev. [[session-per-merge-workflow]]
