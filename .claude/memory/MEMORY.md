# Memory Index

- [Vibrant palette direction](ops-hub-vibrant-palette-direction.md) — ops-hub는 비비드 파스텔(#BA8DFF/#FBC6F2/#24D0FE/#EAFF00) + Playfair Display 지향, 중립 그레이스케일 아님
- [Session-per-merge workflow](session-per-merge-workflow.md) — 한 단계 머지 후 새 세션에서 다음 단계 시작; 핸드오프/원장이 유일한 인계 수단
- [ops-hub cutover target](ops-hub-cutover-target.md) — 완성 시 annual-leave가 쓰는 172.21.10.27:3000(방화벽 개방·외주 재택 유일 경로)으로 이전 예정
- [annual-leave access topology](annual-leave-access-topology.md) — 기존 연차는 kgs-dev 프론트:3000/백엔드:5000 분리, 브라우저가 백엔드 직접호출(IP별 분기), Tailscale 접속은 로그인 안 됨(원래 그럼)
- [Phone test via dev deploy](ops-hub-phone-test-via-dev-deploy.md) — 휴대폰 테스트는 LAN 아님; kgs-dev에 배포 후 Tailscale 접속(http://100.66.58.66:3200, pm2 ops-hub, /home/kgs/apps/ops-hub)
- [Weekly-report expanded scope](weekly-report-expanded-scope.md) — Phase 4 주간보고는 day-sync 단순 포팅 아님; 하이브리드 다중 직무 보고 시스템으로 사무실에서 본격 설계 예정
- [Verify current branch before commit](commit-verify-current-branch.md) — 두 노트북 교대로 브랜치가 예고 없이 바뀔 수 있어 커밋/푸시 전 git branch --show-current로 확인
- [Memory sync key mismatch](memory-sync-key-mismatch.md) — 메모리는 repo `.claude/memory/`에 두고 git 동기화(my-study 패턴), 글로벌 경로는 junction; 집은 clone 후 junction 1회만
- [Review-loop automation philosophy](review-loop-automation-philosophy.md) — 사람=병목, 자동화 극대화하되 위험군(critical·보안·방향전제)만 사람 결정으로
- [User-management merged](user-management-merge-ready.md) — feat/user-management → main 머지 **완료**(b99c7d4, 2026-06-22); 배포 follow-up 4종만 미적용
- [Laptop sync stale artifacts](laptop-sync-stale-artifacts.md) — 노트북 전환 후 typecheck 거짓 실패 시 prisma:generate(stale client)·rm .next(stale build types) 먼저
