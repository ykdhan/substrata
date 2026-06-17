# Substrata 개선 계획 — "쓰기는 되는데 참조가 안 되는" 메모리 루프 복구

> 작성 근거: `bridge-port` 프로젝트의 실제 substrata 사용 데이터를 전수 분석(2026-06-17).
> 대상 레포: `github.com/ykdhan/substrata` (substrata-cli v0.1.1, monorepo `packages/cli`).
> 분석자: Claude / 요청자: YK(레포 author).

---

## 1. 한 줄 요약

substrata는 **footprint를 저장(write)하는 데는 문제가 없지만, 저장된 footprint가 이후 작업에 거의 참조(read)되지 않는다.** 메모리의 핵심 가치인 "과거 결정·학습을 다음 작업 컨텍스트에 주입"하는 피드백 루프가 사실상 끊겨 있다. 근본 원인은 **retrieval/recording을 모델의 자발적 MCP 도구 호출에만 의존**하고, 이를 자동화하는 Claude Code 라이프사이클 훅이 없기 때문이다.

---

## 2. 측정으로 드러난 사실 (bridge-port, 34개 메인 세션 + 87개 서브에이전트 transcript 전수)

| 항목 | 값 | 비고 |
|---|---|---|
| DB에 저장된 footprint | 3 | `.substrata/index/footprint.sqlite`, `integrity_check = ok` |
| FTS 검색 정상 동작 | ✅ | `bot`→3, `recording`→3, `payment`→1 |
| 모델의 `substrata_context` 호출 | **0** | 작업 전 관련기억 주입 — 0건 |
| 모델의 `substrata_search` 호출 | **0** | |
| 모델의 `substrata_related_to_file` 호출 | **0** | |
| 모델의 `substrata_list_recent` 호출 | **1** | |
| 모델의 `substrata_add` 호출(transcript상) | **0** | DB엔 3개 존재 → 외부 경로(CLI 등)로 기록된 것으로 추정 |

> 측정 신뢰성: 동일한 `jq`(`type=="tool_use"`) 집계로 Agent 87회 / TaskUpdate 56회는 정확히 잡혔다. 즉 "substrata 호출 거의 0"은 측정 누락이 아니라 실제 사용 부재다. (초기에 grep으로 나온 "context 30, list_recent 40" 등은 매 세션 주입되는 **도구 목록 나열 텍스트**를 센 오탐이었음.)

**결론:** 메모리는 단방향 저장소로만 존재한다. 저장→활용 루프가 닫히지 않는다.

---

## 3. 근본 원인 분석

1. **자동 retrieval 부재.** substrata는 `substrata_context` MCP 도구를 제공하지만, 에이전트가 작업 시작 시 이를 부를 동기가 없다. 시스템 프롬프트에 "필요하면 불러라"는 권유만으로는 호출률이 0에 수렴한다.
2. **자동 recording 부재.** `config.yml`에 `agent.require_footprint_after_non_trivial_work: true`가 있으나 이를 **강제하는 메커니즘이 없다.** 선언적 설정일 뿐 enforcement가 없다.
3. **기존 `hook` 명령은 pre-commit 시크릿 스캔 전용.** Claude Code의 `SessionStart`/`UserPromptSubmit`/`Stop`/`SubagentStop` 라이프사이클과 연결되는 훅이 전혀 없다.
4. **사용량 가시성 부재.** DB는 read/query 이력을 기록하지 않는다(`documents` 테이블만 존재). 그래서 "얼마나 참조되는지"를 substrata 자체로는 알 수 없고, 외부 transcript를 뒤져야만 했다. → 개선 효과 측정도 불가능한 상태.

---

## 4. 개선 제안 (우선순위순)

### P0 — Claude Code 라이프사이클 훅 추가 (`substrata install --hooks`)

retrieval/recording을 모델 의존에서 빼내 **결정론적 자동화**로 전환. 이게 단일 최대 임팩트.

- **`SessionStart` / `UserPromptSubmit` 훅**: 사용자 프롬프트(또는 변경된 파일)를 입력으로 `substrata context`를 실행 → 관련 footprint 요약을 `additionalContext`로 표준출력에 emit. Claude Code가 이를 컨텍스트에 주입.
  - 토큰 예산은 기존 `search.max_context_tokens`(현재 1600) 재사용.
  - 관련도 임계값 미달이면 아무것도 주입하지 않음(노이즈 방지).
- **`Stop` / `SubagentStop` 훅**: 세션/서브에이전트 종료 시 비자명한 작업이 감지되면 `substrata add`를 자동 트리거(또는 "footprint 남길까요?" 신호). `require_footprint_after_non_trivial_work` 설정을 비로소 실제로 enforce.
- **설치 UX**: `substrata install`이 MCP 등록뿐 아니라 `--hooks` 플래그(또는 기본값)로 `.claude/settings.json`의 `hooks` 블록을 idempotent하게 작성. 이미 있으면 skip(기존 `hook install`의 skip 패턴 재사용).

**구현 메모**
- 신규 서브커맨드: `substrata hook session-start`, `substrata hook prompt-submit`, `substrata hook session-end` (stdin으로 Claude Code hook payload 수신 → stdout으로 결과).
- `packages/cli`에 hook payload 파서 + Claude Code hook 출력 포맷(`{ "hookSpecificOutput": { "additionalContext": "..." } }`) 어댑터 추가.
- "비자명한 작업" 판정 휴리스틱: 편집된 파일 수 / 호출된 쓰기 도구 수 임계값(설정 가능).

### P1 — 사용량/효과 텔레메트리 (read 추적)

개선이 실제로 참조율을 올렸는지 측정 가능하게.

- `documents`와 별도로 `access_log` 테이블 추가: `(ts, op, query, result_count, returned_ids, source)`.
- `context`/`search`/`list`/`related` 실행 시 1행 append.
- 신규 명령 `substrata stats`: 기간별 read/write 횟수, footprint별 hit 수(가장 많이 참조된/한 번도 안 불린 footprint), read:write 비율 출력.
- 프라이버시: 로컬 SQLite에만 기록, 외부 전송 없음(기존 보안 기조 유지).

### P2 — Retrieval 품질 강화

자동 주입이 켜지면 "관련도 낮은 주입"이 바로 노이즈가 되므로 품질이 중요해짐.

- 현재 FTS5(BM25) 단독 → 임베딩 기반 시맨틱 검색을 옵션으로 추가(하이브리드 랭킹). 로컬 임베딩 또는 설정형 provider.
- `related_to_file`를 강화: 현재 작업 중인 파일의 import/이웃까지 확장해 연관 footprint 회수.
- `excludeSuperseded` 기본 on + 오래된 footprint decay(시간 가중)로 stale 주입 억제.

### P3 — 저자 친화적 운영 명령

- `substrata doctor` 확장: "최근 N일 footprint 0건", "read:write 비율 < 임계값", "훅 미설치" 같은 **건강성 경고**를 출력(이번 분석에서 사람이 수동으로 한 일을 자동화).
- `substrata gc`/`supersede --auto`: 중복·구식 footprint 정리 보조.

---

## 5. 마일스톤 / 작업 분해

**M1: 자동 루프 닫기 (P0)** — 가장 먼저, 단독으로도 가치 ✅ 구현 완료
- [x] `hook session-start` / `prompt-submit` / `session-end` 서브커맨드 추가 (`packages/cli/src/commands/hook.ts`)
- [x] Claude Code hook payload ↔ substrata I/O 어댑터 (`packages/cli/src/hooks/claude-code.ts`, `hooks/context.ts`)
- [x] `.claude/settings.json` idempotent 작성: `substrata hook claude [--remove]` + init 위저드 통합 (`packages/core/src/setup/claude-hooks.ts`). 기존 init 레포 retrofit 경로 제공.
- [x] 토큰 예산·관련도 임계값 설정 키 추가 (`hooks.*`: `enabled`, `inject_context`, `max_context_tokens`, `min_score`, `remind_on_stop`, `non_trivial_threshold`)
- [x] README에 "자동 주입/기록" 섹션 + AGENTS.md 안내

> 구현 메모: 모든 런타임 핸들러는 **fail-open**(에러 시 조용히 exit 0)으로 Claude Code 세션을 절대 막지 않음. session-end는 메인 Stop에서만, `stop_hook_active` 가드로 1회만 nudge하며 SubagentStop은 폭증 방지를 위해 억제. 신규 테스트 13개(core 6 / cli 7) 추가.

**M2: 측정 (P1)** — M1 효과 검증용으로 바로 뒤따라야 함 ✅ 구현 완료
- [x] `access_log` 스키마 (별도 DB `.substrata/index/access.sqlite` — 재색인에도 보존, `packages/search/src/telemetry.ts`)
- [x] read 경로에 logging 삽입 (CLI `context`/`search`/`list`, 훅 주입, MCP `context`/`search`/`list_recent`/`related_to_file` — source별 `cli`/`mcp`/`hook` 구분)
- [x] `substrata stats` 명령 (`--days`/`--top`/`--json`: read:write 비율, op/source별, 가장 많이/한 번도 참조 안 된 footprint)

> 구현 메모: 로깅은 best-effort(에러 swallow → read/훅을 절대 깨지 않음). `telemetry.enabled`/`store_queries`로 비활성화·카운트전용 가능. 로그는 로컬+gitignore, 외부 전송 없음. 신규 테스트 8개(search 5 / cli 3).

**M3: 품질 (P2) + 운영 (P3)**
- [ ] 하이브리드(시맨틱) 검색 옵션
- [ ] decay/supersede 정리
- [ ] `doctor` 건강성 경고 확장

---

## 6. 성공 지표 (개선 검증 방법)

M1 배포 후 같은 transcript 분석을 재실행해 다음을 확인:

- **read:write 비율** 0:1 → 목표 **≥ 2:1** (작업당 최소 한 번은 과거 기억 주입)
- `substrata context` 자동 호출 **세션 커버리지 ≥ 90%** (훅이므로 거의 100%여야 정상)
- `substrata stats` 기준 **"한 번도 참조 안 된 footprint" 비율 하락**
- 비자명 작업 후 footprint 기록 누락률 하락(M1의 session-end enforce 효과)

---

## 7. 리스크 / 주의

- **노이즈 주입**: 관련도 낮은 footprint를 매번 주입하면 컨텍스트 오염. → 임계값·토큰 상한·decay 필수(P2와 묶어 점진 적용).
- **훅 침습성**: 사용자 `.claude/settings.json`을 건드리므로 반드시 idempotent + opt-in + 명확한 제거 경로(`substrata install --hooks --remove`).
- **서브에이전트 폭증**: 87개 서브에이전트처럼 fan-out이 크면 `SubagentStop`마다 기록 시 footprint 폭증 가능. → 중복 병합/요약 또는 메인 세션에서만 기록하는 옵션.
- **측정 자체의 함정**: 이번처럼 "도구 목록 나열 텍스트"를 호출로 오인하지 않도록, 텔레메트리는 transcript grep이 아니라 substrata 내부 `access_log` 기준으로 봐야 신뢰 가능.

---

## 부록 A — 현재 CLI 표면(참고)

기존 명령: `add, context, search, list, show, supersede, memory, index, init, install, mcp, hook(pre-commit secret 전용), doctor, run, update`
MCP 도구: `substrata_add, substrata_context, substrata_search, substrata_list_recent, substrata_related_to_file`
설정(`.substrata/config.yml`): `search.default_limit=8`, `search.max_context_tokens=1600`, `security.redact=true`, `agent.require_footprint_after_non_trivial_work=true`(미enforce)
