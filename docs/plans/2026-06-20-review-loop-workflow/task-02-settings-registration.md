# Task 02 — 프로젝트 settings.json Stop 훅 등록

목적: Task 01의 훅 스크립트를 프로젝트 `.claude/settings.json`의 Stop 훅으로 등록한다(글로벌 Stop 훅과 병합 실행). git 추적되어 양 노트북에서 동일 동작.

## Files

- Create(없으면) / Modify(있으면 병합): `.claude/settings.json`

## Prep

- entrypoint §SC-4(훅 입출력 계약). spec §4.2.
- 사용자 환경 검증 사실: 글로벌 statusLine이 `bash -c '...'`로 동작 → 이 머신들에서 bash 경유 훅 명령이 작동함. 그래서 훅 명령도 `bash -c`로 감싼다.

## Deps

- Task 01 (스크립트 존재해야 함).

## Steps

### 1) 현재 settings 확인

```bash
test -f .claude/settings.json && cat .claude/settings.json || echo "(없음 — 새로 생성)"
git check-ignore .claude/settings.json && echo "IGNORED(주의)" || echo "tracked OK"
```
- 파일이 이미 있으면 아래 `Stop` 배열만 기존 `hooks`에 **병합**(덮어쓰기 금지). 없으면 아래 내용으로 생성.
- `IGNORED`로 나오면 git 추적되도록 처리(공유 목적). 보통 `settings.local.json`만 무시되고 `settings.json`은 추적됨.

### 2) `.claude/settings.json` 작성(신규 생성 케이스)

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'node \"$CLAUDE_PROJECT_DIR/scripts/context-threshold-hook.mjs\"'"
          }
        ]
      }
    ]
  }
}
```

### 3) JSON 유효성 + 명령 동작 검증

```bash
# 3a. JSON 파싱
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('settings.json valid')"

# 3b. 등록한 명령을 그대로 실행 — 임계 초과 transcript로 decision:block 확인
node -e 'require("fs").writeFileSync("./v.jsonl", JSON.stringify({type:"assistant",message:{role:"assistant",model:"claude-opus-4-8[1m]",usage:{input_tokens:500000}}}))'
echo '{"transcript_path":"./v.jsonl","session_id":"verify2","stop_hook_active":false}' | CLAUDE_PROJECT_DIR="$(pwd)" bash -c 'node "$CLAUDE_PROJECT_DIR/scripts/context-threshold-hook.mjs"'
echo ""
# 3c. 임계 미만은 무출력(exit 0) 확인
node -e 'require("fs").writeFileSync("./v.jsonl", JSON.stringify({type:"assistant",message:{role:"assistant",model:"claude-opus-4-8[1m]",usage:{input_tokens:100000}}}))'
echo '{"transcript_path":"./v.jsonl","session_id":"verify3","stop_hook_active":false}' | CLAUDE_PROJECT_DIR="$(pwd)" bash -c 'node "$CLAUDE_PROJECT_DIR/scripts/context-threshold-hook.mjs"'; echo "exit=$?"
rm -f v.jsonl
```
기대: 3a는 `settings.json valid`, 3b는 `{"decision":"block",...}` 출력, 3c는 무출력 + `exit=0`.

### 4) 커밋

```bash
git add .claude/settings.json
git commit -m "chore(workflow): 컨텍스트 임계 Stop 훅을 프로젝트 settings.json에 등록"
```

## Acceptance Criteria

- 3a: `settings.json valid` 출력.
- 3b: stdout에 `{"decision":"block",...}` 포함.
- 3c: stdout 비어 있고 `exit=0`.
- `git check-ignore .claude/settings.json` → 비매칭(추적됨).

## Cautions

- **기존 `.claude/settings.json`이 있으면 덮어쓰지 말 것. 이유: 다른 프로젝트 설정/권한이 날아간다.** `hooks.Stop` 항목만 병합.
- **`$CLAUDE_PROJECT_DIR` 확장을 cmd에 의존하지 말 것. 이유: 이 환경의 검증된 경로는 bash다.** `bash -c`로 감싼 형태 유지. 만약 사용자 머신에서 `node`가 bash PATH에 없으면, statusLine과 동일하게 `node`를 절대경로(예: `/c/Program Files/nodejs/node`)로 바꾸는 fallback을 적용한다.
- **`settings.local.json`에 넣지 말 것. 이유: 보통 gitignore라 다른 노트북에 공유되지 않는다.** 공유용은 `settings.json`.
