---
name: memory-sync-key-mismatch
description: 메모리는 repo .claude/memory/에 두고 git 동기화(my-study 패턴); 글로벌 경로는 junction. 절대경로 키가 D:↔C: 달라 junction 필수
metadata:
  node_type: memory
  type: project
  originSessionId: f8b959b0-c1a2-44af-b1d5-2091bc3635b6
---

자동 메모리는 글로벌 `~/.claude/projects/<키>/memory/`에서 로드되고, 키는 **프로젝트 절대경로**로 정해진다(사무실 OMEN `D:\workspace\ops-hub` → `D--workspace-ops-hub`, 집 그램 `C:\workspace\ops-hub` → `C--workspace-ops-hub`). 글로벌 `~/.claude`는 git 동기화 안 됨(수동), repo의 `.remember/`도 `.gitignore`가 `*`라 머신 로컬 — 둘 다 양쪽 자동 동기화 수단이 아니다.

**해결(2026-06-20 적용, my-study와 동일 패턴):** 메모리 파일을 **repo의 `.claude/memory/`**에 두고 git으로 동기화한다(ops-hub `.gitignore`는 `.claude/worktrees/`만 제외 → `.claude/memory/`는 추적됨). 글로벌 키 경로는 repo로 **Junction**: `D--workspace-ops-hub\memory` → `D:\workspace\ops-hub\.claude\memory`. 그래서 메모리 저장은 글로벌 경로로 하면 junction 통해 repo에 기록되고, 커밋하면 양쪽 공유.

**Why:** 두 노트북 교대 작업에서 코드처럼 메모리도 git으로 따라오게 하려고. 사용자 지정 관례(my-study repo에 메모리 커밋). [[session-per-merge-workflow]]

**How to apply (집 그램 최초 1회):** clone 후 junction만 걸면 됨(`.claude` 수동 동기화 불필요 — 메모리는 `git pull`로 옴):
`New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\projects\C--workspace-ops-hub\memory" -Target "C:\workspace\ops-hub\.claude\memory"`
(글로벌에 기존 `C--workspace-ops-hub\memory` 실폴더가 있으면 먼저 비우고 junction.)
