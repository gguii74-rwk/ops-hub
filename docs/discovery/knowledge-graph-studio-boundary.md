# knowledge-graph-studio 경계 분석

## 결론

`knowledge-graph-studio`는 `ops-hub`에 합치지 않습니다.

이 프로젝트는 일반 업무 앱이 아니라 RAG/지식그래프 관리자 워크벤치입니다. Python FastAPI, PostgreSQL/pgvector, DGX LiteLLM/vLLM, read-only serving API라는 특수 인프라가 있으므로 별도 서비스로 유지하는 것이 맞습니다.

`ops-hub`가 할 일은 다음으로 제한합니다.

- 내부 포털 링크 제공
- 서비스 상태 표시
- 운영 문서/런북 링크 제공
- 필요 시 reverse proxy 진입점 제공
- 장기적으로 SSO 또는 인증 프록시 정책 연계

## 현재 구조

주요 컴포넌트:

- `frontend`: Next.js, 포트 3300
- `backend/app.py`: 워크벤치 write API, 포트 8000
- `backend/serving_app.py`: 챗봇 read-only API, 포트 8100
- PostgreSQL 17 + pgvector, 포트 5433
- LiteLLM LLM gateway, 포트 4000
- vLLM embedding, 포트 8082

서비스 경계:

```text
Workbench UI -> app.py :8000
Chat UI      -> serving_app.py :8100
app.py       -> PostgreSQL + LiteLLM + embedding
serving_app  -> PostgreSQL read path + LiteLLM + embedding
```

## 중요한 설계 불변식

### 1. 워크벤치와 서빙 표면 분리

`serving_app.py`는 지식 변경 모듈을 import하거나 호출하지 않는 read-only 표면으로 설계되어 있습니다.

이 경계는 유지해야 합니다.

### 2. loopback 기본 신뢰 경계

`backend/api/security.py`와 `serving_app.py`에는 non-loopback bind/access를 제한하는 코드가 있습니다.

기본 원칙:

- loopback 기본
- non-local bind는 명시 opt-in 필요
- privileged scope는 loopback-only
- CSRF 방어를 위한 Fetch Metadata/Origin 검사

`ops-hub`에서 프록시를 붙일 때 이 정책을 우회하지 않도록 주의해야 합니다.

### 3. 모델 게이트웨이 의존

`model_gateway.py`는 LiteLLM/vLLM 계열 엔드포인트에 강하게 의존합니다.

따라서 `ops-hub`가 이 기능을 직접 흡수하면 일반 업무 앱에 DGX 모델 운영 복잡도가 섞입니다.

## ops-hub 연계 방식

### 1단계: 링크와 상태 카드

`ops-hub` 대시보드에 다음을 표시합니다.

- KGS Workbench 링크
- KGS Chat 링크
- 워크벤치 API 상태
- 서빙 API 상태
- DB 상태
- 모델 gateway 상태

### 2단계: reverse proxy

내부망/Tailscale 기준으로 다음처럼 노출할 수 있습니다.

```text
/kgs       -> KGS frontend
/kgs-api   -> app.py
/kgs-chat  -> serving_app.py
```

단, KGS 자체의 loopback/nonlocal 정책과 충돌하지 않도록 배포 방식을 별도 설계해야 합니다.

### 3단계: 인증 프록시 또는 SSO

KGS는 현재 "신뢰 네트워크 + 표면 분리"에 가깝습니다. 장기적으로는 인증 프록시 또는 SSO를 붙일 수 있습니다.

후보:

- reverse proxy auth_request
- Authelia/Authentik
- Tailscale identity 기반 접근 제어
- NextAuth/OIDC 연동

## ops-hub로 가져오지 않을 것

- RAG answer engine
- vector index
- graph store
- PDF ingestion
- model endpoint registry
- pgvector schema
- DGX 모델 gateway 코드

이들은 KGS 안에 남깁니다.

## 추가 분석 과제

- 실제 systemd 서비스 목록과 포트 확인
- KGS frontend/backend 배포 스크립트 정리
- 서비스 health endpoint 정리
- reverse proxy를 붙일 때 loopback 정책을 유지하는 배포안 작성
- KGS를 포털에서 표시할 최소 상태 API 정의

