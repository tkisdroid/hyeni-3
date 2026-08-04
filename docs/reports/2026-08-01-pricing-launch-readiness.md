# 혜니캘린더 가격·매출화 구현 및 출시 준비도 보고서

- 기준일: 2026-08-02 (Asia/Seoul)
- 대상: `hyeni-3` 앱/PWA 및 `hyeni-1/worker`
- 가격 정본: Premium 월 4,900원 · 연 39,000원
- 사용자 노출 티어: Free · Premium 두 단계
- 현재 판정: **v1.3.0(versionCode 5) 소스 후보 구현, 상용 출시 판정은 HOLD**

> 이 문서는 `docs/plans/2026-07-31-pricing-tier-benchmark.md`를 참고자료로만 사용했다. 기존 보고서의 결론에 구속되지 않고 독립 시장성 검토, 실제 코드, Worker 계약, 운영 스키마와 검증 결과를 다시 비교해 최종 결정을 기록한다.

## 0. 결론

초기 출시 상품은 **Free와 Premium 두 단계만 제공**하고, Premium 가격은 **월 4,900원·연 39,000원**으로 고정한다. 연간제 월 환산액은 3,250원이며 월간제 대비 할인율은 약 33.7%다. SOS와 긴급 알림은 결제 여부와 무관하게 항상 무료로 유지한다.

무료 사용자가 가족 일정과 기본 안전 가치를 충분히 경험한 뒤, 둘째 **신규 연결**·실시간 위치·30일 이력·상세 안심 분석처럼 지불 의도가 높은 순간에만 정확한 차이와 Premium 전환 버튼을 보여주는 구조로 구현했다. iPhone 홈 화면 PWA의 Toss Payments 결제, Android의 Google Play 결제, AI 크레딧 팩, 친구 초대 보상, 최소수집 퍼널, 실제 비용 기반 순매출 원장, 삭제 후 금융 정본 보존도 코드와 스키마에 반영했다.

추천 보상·AI 환불 대사 큐 기아, Play·Toss 교차 결제 충돌 복구, 가족 단위 교차 provider 1회 체험 불변식, Toss 환불 경계조건과 위치 확인자료 정합성을 통합했다. 최종 위험 보완과 Luna 전환 뒤 2026-08-02 현재 작업 트리에서 앱 1,231/1,231, Worker 1,159/1,159, 기존 `hyeni-1` 프런트엔드 2,208/2,208을 통과했고 앱 typecheck/build, Worker TypeScript/Wrangler dry-run, legacy lint/build도 확인했다. 이는 로컬 완결 증거이며 clean commit의 교차 CI·운영 배포·실결제 증거를 대신하지 않는다.

이전 v1.3.0 debug APK SHA-256 `f0c697ecc44f7fbc2443631e62bea7160c6ae436072cead433fce443fb2c1452`를 A17(`RFKL40DP73J`) 부모와 razr(`ZY22H9VTQD`) 아이에 설치해 확인한 결과는 **이전 후보의 역사 기록**으로만 남긴다. 현재 exact debug APK SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`은 두 serial의 `get-state`를 먼저 확인하고 `adb start-server` 뒤 설치를 시도했지만 A17·razr 모두 `device not found`여서 설치되지 않았다. 따라서 현재 exact 후보에는 설치·버전·UI·Android exit 증거가 없다. 역할 전환·로그아웃·재페어링·refresh token 접근은 없었고 S25는 설치·실행·로그·세션 조회를 포함해 조작하지 않았다.

최종 종료 전 Worker의 활성 OpenAI 호출 4개를 중앙 `gpt-5.6-luna`로 교체했다. 기존 Chat Completions·이미지 입력 계약은 유지하되 빈 응답·깨진 JSON·배열·`null`·스칼라를 성공으로 처리하지 않는 객체 파서를 추가했고, `reasoning_effort: "none"`, `max_completion_tokens`, SHA-256 가명 `safety_identifier`를 적용했다. 공식 [Luna 모델 문서](https://developers.openai.com/api/docs/models/gpt-5.6-luna)와 [모델 선택 지침](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6-luna)을 기준으로 했으며, 계약·로그 안전 회귀 11/11과 업데이트된 로컬 `.env` 키의 한국어 아동 안전 text·일정 JSON·합성 한국어 알림장 PNG·하루 요약 live canary 4/4가 `gpt-5.6-luna` 200으로 통과했다. 기존 벤치마크의 `gpt-4o-mini` 원가 가정은 당시 스냅샷으로 보존하고 현재 원가 근거로 재사용하지 않는다.

다만 병렬 감사 도구가 이전 로컬 `OPENAI_API_KEY` 원문을 내부 도구 로그에 1회 노출했다. 값은 코드·Git·최종 산출물에 기록하지 않았고, 사용자가 `.env` 키를 업데이트한 뒤 현재 키로 live 4/4를 다시 통과했으며 현재 키의 비환경 파일 출현은 0건이다. 에이전트는 OpenAI Dashboard의 **이전 키 폐기 여부**와 프로덕션 Worker secret의 교체·readback을 확인할 수 없으므로 두 항목은 배포 전 필수 게이트로 남긴다. 현재 프로덕션 Worker도 구버전이므로 실제 사용자 AI는 아직 Luna 전환 완료 상태가 아니다.

현재 소스 후보에는 신규 웹 구독·AI 크레딧 checkout만 fail-closed로 중지하는 commerce kill switch, 필수 table·column·index를 정확히 확인하고 누락·DB 오류를 503으로 닫는 health readiness, 100% 표본의 개인정보 비포함 집계 로그, 첫 1시간 5xx·고정 큐 추세 판정, Android full-screen intent 허용 범위, 엄격한 출시 승인 evidence 계약을 반영했다. 기존 결제의 완료·대사·해지·환불은 kill switch 중에도 유지한다. 이 방어들은 로컬 검증 완료 상태이며 구버전 프로덕션 Worker에 배포됐다는 뜻이 아니다.

다만 clean commit의 교차 CI, 운영 D1 migration과 Worker/Pages 조정 배포, 결제사 실계약·secret, Play Console 가격/offer 확인, 실제 결제·갱신·해지·환불 E2E, 최신 서명 AAB와 스토어 제출은 남은 게이트다. 따라서 현재 결과를 “오류가 전혀 없는 상용 출시 완료”나 “매출 성공 보장”으로 표현하지 않는다. **소스 후보 구현과 실제 상용 출시 승인은 분리해 판정한다.**

## 1. 보고서별 제안과 최종 결정 비교

| 구분 | 가격·티어 제안 | 채택 여부 | 최종 판정 |
|---|---|---:|---|
| 기존 벤치마크 보고서 | Free + Premium 월 4,900/연 39,000 + Premium Family 월 7,900/연 59,000 | 일부 채택 | 무료 핵심 개방, Premium 가격, 상황형 전환 방향은 채택한다. Family는 초기 출시에서 제외한다. |
| 독립 시장성 검토 | Free + Premium 월 6,900/연 59,000 + Family 월 9,900/연 89,000, AI 팩 별도 | 일부 채택 | PWA 결제, 서버 정본 엔타이틀먼트, MAF 기반 퍼널, 순매출 원장, AI 팩 방향은 채택한다. 고가 3단계 가격은 사용자 확정 가격과 초기 출시 단순성 때문에 채택하지 않는다. |
| 최종 제품 결정 | Free + Premium 월 4,900/연 39,000 | 확정 | 앱·PWA·Worker·문서에서 사용자에게 두 단계만 노출한다. `Family`와 `reviewed`를 별도 판매 티어로 노출하지 않는다. |

### 독립 검토에서 받아들인 핵심

- 일정·메모·스티커는 Free에서도 제한 없이, 준비물·숙제는 두 플랜 모두 아이별 하루 각각 8개까지 제공해 첫 가족 가치를 만든다.
- 위치를 완전히 잠그지 않고 Free에서 약 10분 간격 위치와 오늘 이력을 제공한다.
- 결제 후 권리 판정은 클라이언트가 아니라 서버 엔타이틀먼트 정본으로 닫는다.
- 둘째·한도 초과·첫 위치·첫 도착처럼 의도가 확인된 맥락에서만 업셀한다.
- iPhone 부모의 정본 사용 환경인 홈 화면 PWA에도 실제 결제 경로를 둔다.
- 설치 수가 아니라 가족 단위 MAF → 업셀 → 체험 → 활성 → 갱신으로 측정한다.
- 수수료·확정 환불·AI 변동비·지원비가 실제 자료로 모두 대사된 경우에만 순매출을 계산한다.

### 최종 결정에서 수정하거나 제외한 제안

- `Premium Family`는 초기 출시 상품에서 제외했다. 둘째까지 Premium 한 상품에 포함해 선택 복잡도와 결제·환불·엔타이틀먼트 경우의 수를 줄였다.
- 독립 검토의 월 6,900원/연 59,000원 가설은 적용하지 않았다. 초기 출시는 사용자가 확정한 월 4,900원/연 39,000원을 유지한다.
- `reviewed`는 과거 스토어 방문 혜택을 보존하기 위한 내부 호환 상태일 뿐, 사용자 티어·비교표·결제 상품으로 노출하지 않는다. 신규 지급은 종료하며 claim은 `410 review_reward_program_ended`로 닫는다.
- 가격 인상이나 세 번째 티어는 출시 후 실제 90일 순매출·갱신율·지원비 자료가 쌓인 뒤 별도 실험 대상으로만 검토한다.

## 2. 사용자가 보게 되는 Free와 Premium의 정확한 차이

티어별 수치·권리 정본은 `src/transform/tierPolicy.ts`, 준비물·숙제 저장 상한 정본은 `src/transform/eventSupplies.ts`다. 구독 비교표는 두 정본에서 값을 파생하고 티어 공통 기능을 명시한다.

| 기능 | Free | Premium |
|---|---|---|
| 가격 | 0원 | 월 4,900원 · 연 39,000원 |
| 새로 연결할 수 있는 아이 | 1명까지 | 2명까지 |
| 일정·반복 일정·메모·스티커 | 무제한 | 무제한 |
| 준비물·숙제 | 아이별 하루 준비물 8개 + 숙제 8개 | 아이별 하루 준비물 8개 + 숙제 8개 |
| 위치 보기 | 최신 실측 위치와 정확도, 약 10분 간격 | 실시간 |
| 지금 위치 요청 | 최근 24시간 5회 | 최근 24시간 제한 없음 |
| 위치 이력 | Asia/Seoul 오전 8시 기준 오늘 | 최근 30일 |
| 저장 장소와 도착·출발 알림 | 신규 저장 2곳까지, 생성 시각+id 순 첫 2곳이 알림 대상 | 신규 저장·알림 대상 모두 무제한 |
| 위험구역 안전 알림 | 신규 저장 1곳까지, 생성 시각+id 순 첫 1곳이 알림 대상 | 신규 저장·알림 대상 모두 무제한 |
| 소리 울리기 | 최근 24시간 1회 | 최근 24시간 10회 |
| AI 친구 기본 제공량 | 하루 5회 | 하루 20회 |
| AI 일정 정리 | 하루 5회 | 제한 없음 |
| 기본 안심 리포트 | 제공 | 제공 |
| 위급 주변 소리 | 제공하지 않음 | 최대 1분, 아이 화면·알림에 계속 표시, 자동 종료·감사 기록 |
| 위치 끊김·미등록 체류 | 수동 확인 | 자동 알림 |
| AI 하루 요약 | 제공하지 않음 | 제공 |
| 주간 가족 리포트 | 실제 기록 기반 한 줄 미리보기 | 전체 리포트 |
| 학원 시간표 자동 정리 | 제공하지 않음 | 제공 |
| SOS·긴급 알림 | **항상 제공** | **항상 제공** |

AI 친구의 플랜 기본 제공량은 Free 하루 5회, Premium 하루 20회다. 부모가 이보다 낮은 하루 안전 상한을 직접 정할 수 있으므로 아이가 한도에 도달했을 때 화면은 **부모가 정한 낮은 상한**, **Free 기본 5회 소진**, **Premium 기본 제공량 소진**을 서로 다른 원인과 문구로 안내한다. Free 5회 소진에서는 Premium 20회의 정확한 차이와 구독 CTA를 보여 주고 `/ai-credit` 복귀 의도를 보존한다. 기존 Premium 가족의 낮은 상한은 몰래 20회로 덮어쓰지 않으며, 부모가 `Premium 기본 20회로 설정`을 명시적으로 선택한 경우에만 변경한다. 일반 AI 일정 정리는 Free 하루 5회, Premium 제한 없음이며 직접 일정 추가와 기존 일정 관리는 두 플랜 모두 제한 없이 유지된다. Free 5회 소진 시 원시 `daily_limit_reached`를 노출하지 않고 정확한 사용량·무료 대안·Premium 차이와 `/ai-schedule` 복귀 동작을 한 모달에서 안내한다.

아이 수는 **신규 연결 상한**이다. Premium에서 Free로 내려가도 이미 연결된 아이를 자동 해제하거나 화면에서 숨기지 않는다. 저장 장소·위험구역도 다운그레이드 전에 저장한 초과 데이터를 삭제하지 않으며 조회·수정·삭제할 수 있다. 다만 Free 한도를 넘는 동안 새 항목을 추가할 수 없고, 서버가 생성 시각을 초 단위로 정규화한 뒤 id로 동률을 깨서 고른 저장 장소 첫 2곳·위험구역 첫 1곳만 알림 대상이 된다. Premium으로 복귀하면 보존된 항목 전부가 다시 알림 대상이 된다.

여기서 “알림 대상”은 현재 플랜이 허용하는 대상이라는 뜻이다. 실제 알림은 가족의 등록 장소 알림 master switch, 위험구역별 진입·이탈 설정, 기기 권한·네트워크 등 기존 전달 조건도 함께 충족해야 한다.

엔타이틀먼트 조회가 미확정이거나 실패하면 Free로 추정하지 않고 민감 기능을 열지 않는다. `unknown` 상태로 결제와 Premium 기능을 fail-closed하고, 사용자가 단순 장애를 Free 잠금으로 오해하지 않도록 확인/재시도 상태를 분리한다.

정책 전환 전에 스토어 방문 혜택을 받은 가족은 기존 저장 장소 3곳과 생성 시각+id 순 첫 3곳의 알림 대상 자격만 무손실로 유지한다. 화면에서는 계속 Free로 표시하고, 신규 지급·별도 상품·Premium 권리로 확대하지 않는다.

## 3. 전환 유도 UX

공통 `PremiumUpsell`은 잠근 기능명, 현재 Free 한도, Premium에서 달라지는 값, 원래 화면으로 돌아갈 `returnTo`, 전환 CTA와 `무료로 계속 쓰기`를 함께 제공한다. 안전 기능을 위협하거나 SOS를 유료 혜택처럼 표현하지 않는다.

구현된 업셀 맥락은 다음과 같다.

- 둘째 아이 연결
- 저장 장소 2곳 초과
- 위험구역 1곳 초과
- 최근 24시간 위치 요청 5회 소진
- 오늘보다 과거 위치 이력 조회
- 실시간 위치 모드 선택
- 소리 울리기 1회 소진
- AI 친구 Free 기본 제공량 5회 소진: Premium 20회의 차이와 구독 CTA를 보여 주고, 부모가 더 낮게 정한 안전 상한이면 결제 유도 대신 해당 설정을 정확히 설명
- AI 일정 정리 Free 하루 5회 소진: 직접 일정 추가·기존 일정 관리는 계속 무료임을 밝히고 Premium의 정리 횟수 제한 없음과 원래 탭 복귀를 제공
- 위급 주변 소리 진입
- AI 하루 요약
- 주간 리포트 전체 보기
- 학원 시간표 자동 정리
- 첫 위치 수신 성공
- 첫 도착 확인 성공

퍼널 이벤트는 고정 allowlist, UUID `event_id`, 앱 버전, 발생 시각만 전송한다. 클라이언트 실패는 안전 기능·업셀·결제를 막지 않으며 브라우저 영속 저장소가 아닌 메모리 큐만 사용한다. Worker는 원시 user/family 식별자 대신 HMAC 가족 가명키를 저장하고, 결제 활성·체험·갱신·환불 이벤트는 검증된 서버 경로에서만 생성한다.

## 4. 매출화 구현 범위

### 4.1 Premium 구독 결제

| 채널 | 구현된 계약 | 출시 전 남은 검증 |
|---|---|---|
| Android | Google Play 상품을 결제 직전에 재조회하고 `formattedPrice`, `offerToken`, `offerId`를 정본으로 사용한다. 현재 계정에 정확히 7일 무료 phase가 있는 eligible offer만 체험으로 표시한다. 구매는 Google API로 직접 재검증하고 RTDN도 notification type만 신뢰하지 않는다. | Play Console 한국 가격 월 4,900원·연 39,000원, 실제 7일 offer, App Signing 내부 테스트 구매·복원·갱신·해지·환불 확인 |
| iPhone 홈 화면 PWA | 서버 catalog를 정본으로 Toss Payments 자동결제 월/연 상품을 제공한다. checkout 복귀, 승인 재대사, 갱신·해지·환불 상태, 암호화 billing key와 원격 폐기 재시도를 둔다. Safari/PWA 복귀 과정에서 `sessionStorage`가 유실돼도 인증된 Worker resolver가 현재 사용자 소유권·금액·통화·주문 상태를 모두 대조한 뒤 구독 결제 문맥을 복구한다. 필수 설정이 없으면 503으로 결제만 닫는다. | Toss 자동결제 계약·위험 검토, 동일 환경 client/secret key, sandbox와 live E2E, webhook·환불 운영 절차 |

가족별 `billing_provider_reservations`로 Play와 Toss의 동시 활성화를 막는다. Android는 결제 전에 서버 reservation과 최종 체험 자격을 확인하고, 결제 직전 상품을 다시 조회한다. 충전 후 검증 통신이 끊기면 reservation을 유지해 자동 복구 대상으로 남기고, Toss 활성 가족에서 뒤늦게 확인된 Play 결제는 소유권 검증 뒤 환불·revoke하고 Toss 권리를 복구한다. stale reservation은 15분 뒤 안전하게 회수하며, 가족 단위 체험 claim으로 결제사를 바꿔 7일 체험을 중복 사용하는 경로를 원자적으로 닫았다.

### 4.2 AI 크레딧 추가 매출

- 사용자에게 보이는 팩은 30회·80회·200회다.
- Android는 Google Play 일회성 상품을 사용한다.
- PWA는 서버 catalog에서 가격이 승인된 팩만 Toss 일회성 결제로 노출한다. 보고서나 클라이언트가 가격을 임의로 만들지 않는다.
- iPhone PWA가 결제사에서 돌아올 때 `sessionStorage`가 비어 있어도 인증된 Worker resolver가 주문 소유권·팩 수량·금액·통화·상태를 검증한 뒤에만 AI 크레딧 결제 문맥을 복구한다.
- 주문 claim, 잔액, 원장을 원자 처리하고 재시도로 크레딧을 중복 지급하지 않는다.
- 환불로 이미 사용한 크레딧을 회수하지 못하면 구매 크레딧 부채로 남겨 다음 구매에서 먼저 상계하고 실제 사용 가능 증가량을 공개한다.
- `unknown`·`refund_unknown` 주문은 결제사 확인 전 성공·실패로 단정하지 않는다.
- `ai_parent_settings`는 `(family_id, child_user_id)` UNIQUE 정본과 원자적 `ON CONFLICT` upsert로 한 아이의 설정을 한 행에 유지하고, 이름과 AI 활성값처럼 동시에 바뀔 수 있는 필드는 상대 값을 덮어쓰지 않는다. 기존 중복 행이 있으면 fail-closed migration이 삭제·임의 병합하지 않고 운영자 정규화를 요구한다.

### 4.3 친구 초대

- 구독권이 아니라 초대한 가족과 초대받은 신규 가족에 AI 대화 10회를 한 번씩 지급한다.
- 추천인 가족의 성공 상한은 평생 3가족이다.
- 주 보호자만 `HYENI-` 접두의 80비트 Crockford 코드를 발급한다.
- 본인, 공동 보호자, 기존 가족, 중복 귀속을 서버에서 막는다.
- 신규 가족 생성 후 72시간이 지나고 첫 실제 위치가 확인된 뒤 48시간 유지된 경우에만 서버 cron이 양쪽 원장과 잔액을 지급한다.
- 추천 테이블에는 위치 좌표·주소·자녀 이름을 저장하지 않는다.

### 4.4 실제 순매출 원장

`worker/db/revenue-cost-ledger.sql`과 `worker/ops/channel-90d-net-revenue.sql`은 Google Play와 Toss 채널별로 다음 네 비용만 실제 KRW 금액으로 기록한다.

1. 결제사 수수료
2. 확정 환불
3. AI 변동비
4. 지원비

각 provider × 비용 항목의 90일 coverage가 모두 있어야 순매출과 MAF당 순매출을 계산한다. 실제 0원도 coverage 증빙이 있어야 0으로 인정하며, 하나라도 빠지면 `계산 불가`와 누락 항목을 반환한다. 추정 수수료율이나 임의 AI 원가로 매출을 부풀리지 않는다.

### 4.5 결제·금융 정본 보존

- Toss billing key는 계정 삭제 전에 결제사 원격 폐기를 먼저 시도하고, 성공/이미 없음이 확인된 뒤에만 로컬 암호문을 제거한다. 실패 시 암호문과 재시도 상태를 보존하되 신규 청구는 차단한다.
- 구독 결제와 체험의 최소 금융 기록은 원시 사용자·가족·customer key·billing key 없이 분리하고 5년 보존한다.
- 승인·전액 환불 AI 주문은 지급·회수 수량, 정본 시각, retention 시각을 분리 보존한다. 계정·가족 삭제 뒤 운영 계정과 자동 결합하지 않는다.
- 미승인·실패 주문은 30일 뒤 정리할 수 있지만 `unknown`·`refund_unknown`과 대사 미완료 주문은 자동 삭제하지 않는다.
- 새 DB용 base migration과 기존 DB용 additive migration을 같은 운영 DB에 함께 적용하거나 additive를 재실행하지 않는다.

## 5. 현재 검증 증거와 clean release 경계

Android의 Free 저장 장소 알림 정합성, AAB 내장 웹 자산 출처 증명, Toss 복귀 URL 리퍼러 차단, realtime live socket 상한과 legacy Android-native-only 오디오 송신까지 반영한 현재 작업 트리에서 전체 로컬 회귀를 다시 실행했다. 아래 수치는 로컬 후보의 완결 증거지만, 커밋되지 않은 작업 트리이므로 clean exact SHA의 교차 CI·서명 release·운영 배포 증거로 확대하지 않는다.

| 영역 | 최근 확정 관측 | 최종 승인에 필요한 것 |
|---|---|---|
| `hyeni-3` 앱 | 1,231/1,231, typecheck·production build 통과 | clean exact SHA 교차 CI와 Pages provenance 연결 |
| `hyeni-1/worker` | 순차 전체 1,159/1,159, TypeScript·Wrangler dry-run 통과 | clean exact sibling SHA 교차 CI와 운영 migration-first 배포/readback |
| OpenAI Luna | 업데이트된 로컬 `.env` 키로 활성 4경로 live verifier 4/4, HTTP 200, 응답 model `gpt-5.6-luna` 확인. 검증 출력에는 API key와 생성 content를 남기지 않았다. | 이전 키 폐기 확인, production Worker secret 교체/readback, 실제 승인 알림장·연령별 아동 안전 대화 품질 E2E, Worker 배포 |
| 기존 `hyeni-1` 프런트엔드 | 2,208/2,208, ESLint·Vite build exit 0 | clean exact sibling SHA 교차 CI와 운영 Worker 계약 smoke |
| 가격·티어 focused 회귀 | 앱 58/58, Worker 38/38, Android JVM 167/167 통과 | Play/Toss 실제 가격·체험·결제와 운영 티어 E2E |
| 출시·보관 증거 | 최신 schema v4 `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json`의 SHA-256은 `e552dd6655d4e6a0b467cac0d0acba73f5ae9f79a410b657926e1fcd242d0c18`, verification log SHA-256은 `1bd78d88dfa4cb717bf4f73d1a8bf116cb653135d01560daa9c472816f0a483f`이며 source/Android/AAB web projection `matched:true`, archive integrity, 권한 24개 exact policy와 16KB ZIP·ELF 정적 검사가 통과했다. `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json`은 verdict `HOLD`·`humanApprovalRequired=true`·blocker 27건을 정확히 반환했다. 양 저장소 dirty, release AAB source SHA·upload certificate·CI·Pages provenance·launch approval 누락과 평문 서명 자격정보 파일 존재 감지가 포함된다. 자격정보 파일은 읽거나 수정하지 않았다. | clean CI, 승인 서명 release AAB·Pages provenance·배포 ID·운영 실기기 네트워크 증거와 권한 있는 사람의 최종 승인 |
| Android local debug | 최종 dist를 `cap sync`한 뒤 unit 172/172와 manifest policy 33/33을 통과했고 lint 오류 0·경고 13을 확인했다. 경고 13건은 사용되지 않는 레거시 리소스와 기존 런처·스플래시 이미지 구성 경고다. APK 13,092,876 bytes·SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`, debug AAB 12,018,080 bytes·SHA-256 `eb0eb5b2288de6771c3e70cc3e5bbe7eaeb3fa62d1f85d1d2ce318748631c2c5` | debug 서명이며 Play 업로드 불가. clean CI 승인 인증서 release AAB·schema v4+Pages record·실제 16KB 런타임·Play 내부 테스트와 Worker-first 배포 후 A17/razr 재검증 |
| Android exit evidence | 현재 exact APK 설치 전 serial별 `get-state`와 `adb start-server` 뒤 재확인까지 했지만 A17·razr 모두 `device not found`였다. 현재 exact 후보의 package version·UI·Java crash·native crash·ANR 증거는 없다. 이전 SHA-256 `f0c697ecc44f7fbc2443631e62bea7160c6ae436072cead433fce443fb2c1452` 후보의 설치·exit 결과는 역사 기록일 뿐 현재 증거로 재사용하지 않는다. | 두 허용 기기가 연결된 뒤 같은 exact APK를 `adb install -r`로 설치하고 package version·UI·exit 집계, 장시간 실사용·상태 변경 네이티브 E2E와 Play pre-launch/Android vitals 확인 |
| 브라우저 | exact local production `dist` 414파일·tree SHA-256 `21fd847bd3b5e64d71beaa329155d3273ac8d5bfdaa2dc87b24d63356dd6c1e5`, `index.html` SHA-256 `c4a51f17136795d0eba64467c77d965614cf5964381b78d1796072be3d8b616a`, JS 479,697 bytes, CSS 30,849 bytes의 격리 QA: 부모 42/42·아이 14/14, 문제 0. 증거 `artifacts/release-evidence/browser-qa/20260802T141931-final-21fd847/report.json` | 인증된 운영 부모·아이 데이터, 실제 지도/Web Push·결제와 네이티브 동작은 별도 E2E |
| PWA 런타임 | 같은 exact dist에서 Service Worker install·control, 실제 `navigator.onLine=false` 오프라인 reload, uncached probe 차단, 새 controller 교체와 문서 reload를 문제 0으로 통과했다. `registerType: prompt`의 중요 작업 보호형 업데이트이므로 결제·대사·주변 소리·mutation·미저장 입력 중에는 reload를 보류하고, 안전한 시점에 waiting Worker를 활성화한 뒤 실제 `controllerchange`에서 정확히 한 번 reload한다. 증거 `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`. WebKit smoke도 PASS였지만 offline reload는 Playwright 엔진 오류로 미검증이며 실제 iPhone 증거가 아니다. | 실제 iPhone Safari 홈 화면 standalone·Web Push·배포 전 구버전 탭의 중요 작업 보호형 업데이트 E2E |
| 성능 | 모바일 Lighthouse A/B/A 3회씩 재측정에서 preconnect 제거안이 일관된 개선을 만들지 못했고, 복원 기준 median performance 93·synthetic LCP 2,866ms였다. 관측 LCP도 제거안 159ms보다 복원안 116ms가 빨라 변경을 보류했다. | 운영 RUM과 저사양·불안정망 LCP/INP 관측 뒤 실제 병목만 최적화 |

v1.2.0의 앱 1,072/1,072·Worker 1,037/1,037, PWA precache 320개, entry 472,252 bytes, debug APK SHA-256 `246A1513CA9D9951D7857654B538398A9D175605F097331EAADDE2DBA2D243F5`와 A17·razr 결과는 당시 후보의 역사 증거로만 보존한다. v1.3.0 산출물이나 실기기 증거로 재사용하지 않는다.

## 6. v1.3.0 실기기 검증 상태

2026-08-02 KST의 현재 exact v1.3.0 debug APK는 13,092,876 bytes(SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`)다. A17(`RFKL40DP73J`) 부모와 razr(`ZY22H9VTQD`) 아이의 exact serial에 대해 각각 `get-state`를 먼저 확인하고 `adb start-server` 뒤 재확인했지만 둘 다 `device not found`였다. 따라서 `adb install -r` 설치, versionCode·versionName 확인, UI·네트워크·exit 검증은 수행되지 않았다. 역할 전환·로그아웃·재페어링·refresh token 접근은 하지 않았고 S25는 설치·실행·로그·세션 조회를 포함해 조작하지 않았다.

- SHA-256 `f0c697ecc44f7fbc2443631e62bea7160c6ae436072cead433fce443fb2c1452`인 이전 v1.3.0 후보는 과거 A17·razr에 설치됐고 A17 부모 UI와 양쪽 exit 집계가 확인됐다. 이 결과는 **역사 증거**이며 현재 SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873` 후보의 설치·UI·exit 증거로 재사용하지 않는다.
- 이전 후보에서 razr foreground UI가 secure keyguard·Dozing으로 차단됐던 사실도 역사 기록이다. 현재 후보는 기기 연결 자체가 없어 잠금 상태까지 새로 판정하지 않았다.
- 이전 후보의 실기기에서 `/api/realtime/ticket`과 `/api/premium-funnel/events` 404가 관측됐다. 프로덕션 Worker가 아직 조정 배포 전이라는 위험 신호로 유지하되, 현재 exact 후보의 실기기 네트워크 결과로 표현하지 않는다.
- 두 허용 기기를 다시 연결한 뒤 같은 SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873` APK를 `adb install -r`로 설치하고 versionCode 5·versionName 1.3.0, 부모·아이 UI, package-specific Java/native crash·ANR을 새로 확인해야 한다.
- 네이티브 아이 FCM/pending ACK, 백그라운드 위치, 마이크 foreground service, Usage Access, 원격제어, 실제 결제처럼 상태를 바꾸는 동작은 수행하지 않았으며 별도 출시 게이트다.

## 7. 통합 완료한 출시 차단 결함

| 우선순위 | 결함 | 적용한 방어 | 검증 결과 |
|---|---|---|---|
| 출시 차단 | 추천 보상 선두 미자격 항목에 의한 지급 큐 기아 | 실제 48시간 위치 증거를 요약 trigger와 ready partial index로 후보화하고 오래된 미자격 행이 제한 batch를 점유하지 못하게 했다. | backlog·중간/역순 위치 fix 재생 회귀 통과 |
| 출시 차단 | AI 크레딧 환불 대사 `unknown` 선점에 의한 완료 주문 검사 기아 | `unknown/refund_unknown`과 완료 주문을 상태별 bounded batch로 공정하게 처리한다. | backlog 재생 회귀 통과 |
| P0 | 환불 funnel 실패가 금융 대사를 중단하고 환불된 미확정 결제를 다시 활성화 | 분석 재시도와 금융 대사를 분리하고, `done` 복구 전에 Toss 정본을 다시 확인한다. | 승인 직후 환불·최초/갱신 finalize 경합·funnel 장애 회귀 통과 |
| P0 | 자연 만료·과거 갱신·Google 활성 충돌 주문 환불 누락 | 모든 미완료 환불 주문을 전역 FIFO로 대사하고 현재 권리를 건드리지 않는 audit-only 경로와 Google conflict 복구를 분리했다. | 전액·부분·과거·자연 만료·Google 충돌 회귀 통과 |
| P0 | 환불 웹훅과 계정 삭제 경합·무관 웹훅 재전송 폭증 | mutation lease로 선형화하고 삭제 직전 `done`도 provider 재조회한다. 다른 상품·미상 이벤트는 200 ACK, 일시 장애만 429/503이다. | 삭제 경합·교차상품 webhook 회귀 통과 |
| P1 | 환불 fallback 12건/일·1825일 보존·취소 100건 상한 | 5분 offset 전역 FIFO로 144건/일, UTC 달력 5년, 512KiB 응답 상한 안의 전체 취소 검증으로 교체했다. | cron query budget·윤일·101건 취소 회귀 통과 |
| P0 | 출시 체크리스트의 기존 Toss DB 순서에서 환불 migration 누락 | 정본 환불 런북과 맞춰 key revocation → 가족 체험 claim → 환불 → 금융 보존 순서와 비정상 중간 상태 배포 중단 조건을 명시했다. | Worker README·환불 런북·Play 출시 체크리스트 교차 대조 |
| P0 | Play 구매 후 provider 충돌로 생기는 이중결제·Toss 갱신 중단 | 구매 전 reservation, ref→token hash 전환, 15분 stale 회수, 소유권 검증, Play 자동 환불·revoke, Toss 권리 복구를 멱등 상태머신으로 묶었다. 검증 손실 시 reservation을 섣불리 해제하지 않는다. | Google/RTDN·구독 보안 focused 회귀 통과 |
| P1 | Toss 체험 뒤 Play 2차 체험 가능성 | provider를 기록하는 가족 단위 lifetime trial claim을 원자적으로 적용하고 Android 결제 직전 서버 자격을 재확인한다. | 교차 provider·동시성 회귀 통과 |
| P0 | 활성 Google 구독 A가 있을 때 중복 토큰 B 직접 검증 | B의 소유권을 확인한 뒤 B만 환불·revoke하고 A 권리는 유지한다. 실패는 retryable 503으로 닫는다. | 직접 verify·중복 토큰 회귀 및 Google/RTDN 46/46 통과 |
| P0 | Qonversion 보조 경로가 Google/Toss 정본을 덮어쓰는 경쟁 | atomic `WHERE` guard와 race readback으로 `google_play`·`toss_web` 권리를 보존한다. | 구독 보안 회귀 통과 |
| P0 | current/history 이중 저장의 느슨한 확인자료 중복 제거와 추정 위치 혼입 | 같은 가족·자녀·행위·실측 시각에서 reciprocal `service_code`가 정확히 일치할 때만 한 건으로 합치고 `history_estimated`는 제외했다. Android·SOS도 같은 `GeolocationPosition.timestamp`를 두 저장 경로에 전달한다. | trigger 직접 재생·역순 저장·SOS 계약 회귀 통과 |
| P0 | 추천 지급이 6개월 확인자료 원장을 반복 스캔하거나 미지급 행 때문에 보존 삭제가 지연될 위험 | 실제 수집 시점에 좌표 없는 첫 fix·48시간 경계 요약만 추천 행에 반영하고, 추천 cron은 summary-only로 판정한다. 확인자료는 지급 상태와 무관하게 달력 6개월 뒤 bounded 삭제한다. | 추천 집중 50/50과 최종 Worker 전체 1,159/1,159 통과 |
| P1 | 위치 확인자료 감사 API의 기본 1,000건 응답이 이후 행을 조용히 절단할 위험 | 모든 성공 응답을 `{ records, hasMore, nextCursor }`로 고정하고 `(occurred_at DESC, id DESC)` keyset cursor를 가족·기간·자녀 scope에 묶었다. | 같은 시각 1,005건 전체 순회, cursor 변조·scope 재사용·권한 회귀 통과 |
| P1 | 무료 사용자가 저장 장소 2개를 채운 뒤 주 추가 버튼을 누르면 구독 설명 없이 toast만 표시되어 전환 동선이 끊김 | 장소 관리 주 진입점에서도 상황형 `PremiumUpsell`을 열어 현재 사용량, Free/Premium 차이, `무료로 계속 쓰기`, 구독 CTA와 결제 후 `/place-form` 복귀 intent를 제공한다. | 자동 계약 회귀와 final local bundle 390×844 QA 통과. 저장 장소 3개 중 active 2·premium-required 1·unknown 0, `saved_place|saved_places` return source의 `/place-form` 복귀·intent clear, 무료 계속 쓰기를 확인했다. |
| P1 | 위치 확인자료 추가 쓰기를 D1 Free 용량·일일 쓰기 한도에 기대는 출시 위험 | 식별자 없는 `ops/location-confirmation-capacity.sql`에 쓰기 하한·용량·보존 backlog·중복 진단과 50/70/85% 조치 기준을 추가했다. | SQL·정적 계약은 통과, 실제 Workers Paid 플랜과 운영 사용량 readback은 외부 출시 게이트 |
| P0 | clean Git·manifest SHA만 기록해 ignored Android public이 현재 Pages `dist`인지 증명하지 못했고, 단순 tree 동일 비교는 정상 Capacitor의 0바이트 `cordova.js`·`cordova_plugins.js`와 AAPT가 제외하는 `.well-known/assetlinks.json`까지 오류로 오판함 | schema v4가 source dist, post-sync public, universal APK public의 raw hash와 정규화 투영을 모두 기록한다. 루트 0바이트 cordova 2개와 이름·바이트·해시가 고정된 338바이트 `assetlinks.json` 제외 1개만 허용하고 나머지는 exact parity로 검증한다. archive entry 충돌·feature module web asset·TOCTOU도 fail-closed하며 release record가 현재 dist·Pages provenance와 재검증한다. | 최신 local debug evidence `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json`은 source 414/tree `21fd847bd3b5e64d71beaa329155d3273ac8d5bfdaa2dc87b24d63356dd6c1e5`, Android/embedded projection 413/`4a6af8c84ec2196557b89f23dacfd6b236910364279eda0a7b9ecb2453d18d15`, cap public 416/`821819718fe49b1a38a6495dc76d4cb32465b0c8e56a1442dc1c9efa90d248fa`, embedded public 415/`0f291bf20aa104405738b405d98378e793fdcdf4821a16b31a9670cbd3bb5cbc`이며 `matched:true`, archive 961/2/955 safe, integrity true다. evidence SHA-256은 `e552dd6655d4e6a0b467cac0d0acba73f5ae9f79a410b657926e1fcd242d0c18`, verification log SHA-256은 `1bd78d88dfa4cb717bf4f73d1a8bf116cb653135d01560daa9c472816f0a483f`다. debug 서명이므로 Play 업로드는 불가하고 사람의 최종 GO도 아직 없다. |
| P1 | Toss 복귀 query의 `authKey`·`paymentKey`가 React effect의 URL 정리 전에 same-origin asset Referer로 전파될 수 있음 | 최초 HTML meta, Pages `_headers`, Toss SDK script 모두 `no-referrer`로 고정했다. | `paymentRedirectReferrerSafety`·`securityHeadersContract`와 최종 앱 1,231/1,231·Worker 1,159/1,159 통과. 실제 Pages 응답 헤더는 배포 후 확인해야 한다. |
| P1 | realtime ticket의 미소비 수만 제한해 ticket을 순차 소비한 live socket을 사용자·room 상한 없이 유지할 수 있고 hibernated 만료 socket이 남음 | Family/Teacher room에서 만료·손상 socket을 1008로 닫아 제외하고 live 8/user·64/room 상한을 accept 전에 검사한다. 초과는 `429`와 `Retry-After: 30`, ticket 응답은 `no-store`로 닫았다. | Worker focused 15/15, realtime·결제 추가 139/139, Worker TypeScript 통과. 배포 뒤 9번째·65번째 실제 WebSocket과 클라이언트 exponential backoff 관측은 남았다. |
| P1 | 서버 FamilyRoom은 ping 외 client WebSocket payload를 1008로 닫는데 legacy `hyeni-1`이 `channel.send`를 raw `sock.send()`로 보내 성공처럼 처리했다. REST 전환 뒤에도 `App.jsx`의 3개 broadcast 호출이 Promise 실패를 놓칠 수 있었고, 서버 정본이 Android native WAV+세션 검증인데 WebView MediaRecorder `audio/webm` fallback과 child socket 준비 의존이 남아 있었다. | legacy family socket을 ping-only 수신 연결로 고정하고 송신 queue/API를 제거했다. `channel.send`는 Bearer 인증과 family/role/audience를 서버에서 다시 검증하는 `/realtime/v1/api/broadcast`를 사용하며 3개 호출부는 `await` 또는 `void ... .catch`로 실패를 처리한다. WebView `audio/webm` fallback과 child socket 준비 의존을 제거하고 Android native가 아니면 `remote_listen_requires_android_native`로 fail-closed한다. 부모 iPhone PWA 제어+아이 Android native WAV 캡처 계약은 유지한다. | legacy realtime focused Vitest 18/18과 대상 ESLint 통과. 배포 뒤 실제 아이 Android WAV가 세션 검증을 거쳐 요청 부모에게만 도착하고 미지원 환경이 정확한 오류로 닫히는 E2E는 남았다. |
| P1 | Android가 등록 장소 알림 master 설정 조회 실패·누락을 `true`로 간주해 사용자가 끈 Free 네이티브 알림을 열 수 있음 | 서버 응답이 정확히 1행이고 값이 Boolean `true`일 때만 허용하며, refresh 시작·예외·빈 응답에서는 즉시 `false`로 닫고 cache를 비운다. 초과 장소 데이터는 삭제하지 않는다. | Android tier 회귀는 통과했다. 이전 후보의 A17 UI 결과는 역사 증거이며, 현재 exact 후보의 A17·razr UI와 master off·조회 실패 상황의 실제 네이티브 알림 발사 여부는 기기 미연결로 미검증이다. |
| P0 | 운영 장애 때 결제 화면을 열어 새 승인만 늘리거나, kill switch가 완료·대사·해지·환불까지 막을 위험 | commerce kill switch는 설정 누락·유효성 오류·DB 실패 때 신규 웹 구독과 AI 크레딧 catalog/checkout만 fail-closed한다. 이미 시작된 결제의 completion·reconcile과 기존 구독의 cancel·refund는 계속 사용할 수 있다. | 로컬 Worker 계약·전체 1,159/1,159 통과. 프로덕션 배포·readback 전에는 운영 적용으로 간주하지 않는다. |
| P0 | 단순 `/api/health` 200이나 부분 스키마로 새 Worker를 여는 위험 | health readiness가 정확한 필수 table·column·index를 확인하고 누락 또는 DB 오류를 503으로 닫는다. | 로컬 TypeScript·dry-run·전체 Worker 통과. 현재 프로덕션은 구버전이므로 migration-first 배포 후 exact readiness readback이 필요하다. |
| P0 | 출시 직후 장애 로그의 민감정보 노출, 저표본 오판, 대기열 누적을 놓칠 위험 | request outcome·cron 관측 로그를 100% 표본의 개인정보 비포함 집계값으로 제한하고 raw Error·path·식별자·body·token·content를 남기지 않는다. 첫 1시간 rollback은 `serverErrors >= 5`이면서 5xx율이 `> 1%`일 때만 발동하고 요청 0건은 `INCONCLUSIVE`다. 고정 큐는 T-10/T+30/T+45/T+60 집계에서 두 연속 구간 모두 엄격 증가하면 `ROLLBACK_REQUIRED`, 누락·형식 오류·stale·시각 역전은 `INCONCLUSIVE`로 닫는다. | privacy/observability·운영 판정 회귀와 최종 Worker 전체 통과. 실제 운영 집계 snapshot은 배포 뒤 별도 증거다. |
| P0 | 일반 일정·메모 알림이 공격적 urgency metadata로 잠금 화면 full-screen UI를 열 위험 | Android full-screen intent는 SOS·emergency·danger·force ring·위급 주변 소리처럼 정책상 허용된 긴급 안전 경로에만 사용한다. 일정·일정 리마인더·메모·미도착·도착 실패는 metadata와 무관하게 full-screen intent를 사용하지 않는다. | Android unit 172/172·manifest policy 33/33·lint 오류 0 통과. 실제 잠금 화면 정책 동작은 razr 잠금 해제 뒤 상태 변경 E2E로 남았다. |
| 출시 차단 | 자동 생성 release record가 있으면 사람의 승인 없이 GO로 오인할 위험 | strict launch approval artifact는 exact app/Worker commit, 12시간 이내 증거, 월 4,900원·연 39,000원, 모든 외부 섹션 충족, 서로 다른 primary/alternate observer를 기계 검증하고 hash로 고정한다. | 기계 검증 통과는 증거 무결성만 뜻한다. 외부 증거와 권한 있는 사람의 최종 GO가 없으면 항상 `HOLD`다. |

결제 route의 외부 provider·DB 예외 원문도 제거하고 공개 응답을 고정 오류 코드로 축약했다. 이는 코드 계약 검증이며 실제 Google/Toss 거래 E2E를 대체하지 않는다.

## 8. 코드 밖 출시 게이트

| 게이트 | 현재 확인 상태 | 출시 완료 증거 |
|---|---|---|
| 운영 D1 | 2026-08-02 12:02 KST read-only 재실측에서 출시 필수 객체 25개 중 2개만 존재하고 23개가 없었다. AI balance 중복 1그룹·6행이 있어 unique migration 전 5행을 제거하는 **파괴적 정규화**가 필요하다. 익명 집계상 구매 크레딧·일일 사용량 감소 징후는 없지만 운영자 승인 없이 실행할 수 없다. `ai_parent_settings` 중복은 0이지만 exact unique index가 없고, 퍼널의 `ai_friend_limit`·`ai_schedule_limit` source 허용도 모두 0이다. 필수 컬럼 `google_play_purchase_events.debt_applied`, `web_billing_charge_attempts.refund_status`, `web_billing_charge_attempts.customer_key`, `web_ai_credit_orders.record_scope`도 모두 부재했다. 쿼리 결과는 `changes=0`, `changed_db=false`, `rows_written=0`이고 `artifacts/release-evidence/d1-readonly-preflight-20260802-120214.json`에 고정했다. | 격리 사본 dress rehearsal, 유지보수 창, 직전 재진단, 행 단위 복구 자료·Time Travel bookmark, 운영 책임자의 명시적 승인 뒤 AI 중복 정규화와 migration·새 Worker를 연속 수동 실행하고 exact health/readback 확인. 기존 퍼널 테이블에는 `premium-funnel-ai-schedule-limit.sql`을 정확히 1회 적용하고 최종 `has_ai_schedule_limit_source=1`을 확인해야 하며, 아니면 HOLD |
| D1 플랜·용량 | 로컬에는 식별자 없는 용량 SQL과 50/70/85% 조치 기준을 마련했지만 운영 계정의 실제 플랜·DB byte·최근 `rows_written`은 확인하지 않았다. Cloudflare 공식 [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)는 Free DB당 500MB·invocation당 50 query, Paid DB당 10GB·1,000 query를 명시하고, [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)은 Free 일 100,000 rows_written 한도를 명시한다. | **Workers Paid** 플랜 확인, `ops/location-confirmation-capacity.sql` 결과와 Dashboard/GraphQL 최근 24시간 `rows_written`·DB byte 연결, 50% 용량 설계·70% 분리 리허설·85% 확대 HOLD 준수 |
| 위치 감사 cursor | 로컬 API는 전용 HMAC-SHA-256 secret으로 payload를 서명하고 scope와 keyset 위치를 검증한다. 운영 `LOCATION_AUDIT_CURSOR_SECRET`은 아직 설정·readback하지 않았다. | 32바이트 이상 전용 secret 설정, 누락·짧은 secret 503, payload·서명 변조와 가족·기간·자녀 scope 재사용 400, 같은 시각 1,005건 누락·중복 0 확인 |
| Premium 퍼널 | `PREMIUM_FUNNEL_HASH_SECRET` 미설정 | secret 설정, 503→정상 수집 전환, 원시 family/user 저장 0 확인 |
| OpenAI Luna 운영 | 로컬 `.env` 키로 live verifier 4/4·HTTP 200·model `gpt-5.6-luna`를 확인했지만 프로덕션 Worker는 구버전이고 이전 키 폐기 여부와 운영 secret 교체 상태를 확인하지 못했다. | OpenAI Dashboard에서 이전 키 폐기 확인, production Worker secret 교체, 배포 뒤 key/content 비노출 canary와 secret readback |
| Toss 구독 | client/secret key와 billing-key 암호화 secret, 자동결제 실계약이 준비되지 않음 | 같은 환경 키, 자동결제 계약·위험 검토, checkout·갱신·해지·환불·webhook·키 폐기 E2E |
| Toss AI 팩 | 30/80/200팩 KRW 환경값 미설정 | 승인 가격의 server catalog와 각 팩 승인·중복 재시도·환불 E2E |
| Play 개발자·정산 계정 | 실제 계정 유형·생성일, production access, merchant account·payments profile·지급수단 검증과 App content 선언 상태를 로컬에서 확인할 수 없음 | 조건에 해당하면 12명 연속 14일 비공개 테스트와 production access 승인, 개발자 신원·연락처·merchant 지급수단 검증, 최종 AAB 기준 광고 없음 선언 |
| Google Play | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, RTDN audience·push 계정과 실제 Console 가격/offer 미확인. package는 미설정 시 `com.hyeni.calendar` 기본값을 사용하지만 Console 대조가 필요하다. | 월 4,900/연 39,000 `formattedPrice`, 정확한 7일 eligible offer, 내부 테스트 구매·복원·갱신·해지·환불·RTDN |
| 교차 결제 | 상태머신·자동 회귀 완료, 실제 두 결제사 거래 미검증 | Toss 활성→Play 실결제, Play 활성→Toss 실결제, 체험 교차, 네트워크 중단, stale reservation을 sandbox/내부 테스트에서 재생 |
| 법적 문구 | 운영 `/terms`·`/privacy`·`/data-deletion`은 HTTPS 200·한글이지만 현재 공개본에 Toss Payments·자동결제·AI 크레딧·추천·5년 금융 보존·출시 가격 문구가 없고, 운영 위치 확인자료 스키마도 아직 없다. | 위치정보사업/위치기반서비스 신고·등록 유형, 동의 필수 고지, 확인자료 필드·6개월 보존·열람 절차의 법률 검토와 필요한 증빙. 위치 schema readback 뒤 최신 세 페이지 배포·readback |
| iPhone PWA | exact local production dist의 Service Worker install·control, 실제 오프라인 reload·uncached 차단, `registerType: prompt` waiting Worker의 안전한 활성화·실제 `controllerchange`·문서 reload와 외부 요청 0을 격리 Chrome에서 통과했다. 결제·대사·주변 소리·mutation·미저장 입력 중 reload를 보류하는 중요 작업 보호 계약도 회귀로 고정했다. 운영 `VAPID_PUBLIC_KEY`·`VAPID_PRIVATE_KEY`가 없어 Web Push를 열 수 없으며 이 결과는 실제 iPhone 홈 화면 증거가 아니다. | VAPID 구성 뒤 실제 iPhone 홈 화면 설치, active Service Worker·Web Push, AudioContext, 배포 전 구버전 탭 중요 작업 보호형 업데이트, Toss 실제 checkout·복귀·갱신·해지·환불 E2E |
| 아이 Android | 현재 exact v1.3.0 debug APK 설치를 시도하기 전후 exact razr serial을 확인했지만 `device not found`였다. 따라서 설치·versionCode·versionName·foreground UI·crash/native crash/ANR 집계 증거가 없다. 이전 SHA-256 `f0c697ecc44f7fbc2443631e62bea7160c6ae436072cead433fce443fb2c1452` 후보의 설치와 secure keyguard·Dozing 차단 결과는 역사 기록으로만 보존한다. | razr가 연결되고 사용자가 잠금을 해제한 상태에서 현재 exact APK 설치·버전, 아이 UI, FCM/pending ACK, 백그라운드 위치, 마이크 FGS, Usage Access, full-screen intent 정책, master off·조회 실패, 원격제어, 메모·신고·차단 양방향 E2E |
| 배포 산출물 | v1.3.0/versionCode 5 최신 local debug APK/AAB와 `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json` schema v4 provenance는 최종 dist와 `matched:true`로 통과했다. APK는 13,092,876 bytes·SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`, debug AAB는 12,018,080 bytes·SHA-256 `eb0eb5b2288de6771c3e70cc3e5bbe7eaeb3fa62d1f85d1d2ce318748631c2c5`다. evidence JSON SHA-256 `e552dd6655d4e6a0b467cac0d0acba73f5ae9f79a410b657926e1fcd242d0c18`, verification log SHA-256 `1bd78d88dfa4cb717bf4f73d1a8bf116cb653135d01560daa9c472816f0a483f`. 권한 24개 exact policy와 bundle config·universal APK ZIP·모든 ELF의 16KB 정적 검사는 통과했지만 debug certificate 산출물이므로 Play 업로드는 불가하다. | clean CI에서 동일 공개 환경값으로 build→`cap sync`→승인된 인증서 서명 release AAB 생성 후 schema v4 raw/투영·archive·integrity·manifest policy evidence를 현재 dist·Pages artifact와 연결한 strict release record, Play App Signing `assetlinks.json`, Families·법적 선언, 내부 테스트 설치, 권한 있는 사람의 최종 GO |
| Android 호환성 | local debug AAB의 bundle config 16KB, universal APK `zipalign -P 16`, native library 4개·LOAD 9개·최소 alignment 16,384가 통과했다. | 승인 인증서로 만든 release/Play 산출물에서 같은 정적 검사를 반복하고 실제 `PAGE_SIZE=16384` 기기에서 설치·실행·핵심 경로 검증 |
| 서명 자격정보 | `android/keystore/hyeni-upload-credentials.txt` 평문 파일의 존재만 확인했으며 내용은 읽지 않았다. | 운영자가 비밀번호 관리자로 이전한 뒤 평문 파일·백업·휴지통 사본을 직접 삭제하고, 외부 노출 가능성이 있으면 자격정보를 회전한 증거 확인 |
| App Links | 운영 `assetlinks.json`은 HTTPS 200·JSON이지만 현재 debug 인증서 SHA-256만 연결한다. | Play App Signing 인증서 지문으로 교체하고 debug 지문 제거, 내부 테스트 설치본 `pm get-app-links`의 `verified` 확인 |
| 프로덕션 배포 | 기존 `/api/health`는 200이지만 이전 APK 후보의 실기기에서 `/api/realtime/ticket`과 `/api/premium-funnel/events`가 404였다. 운영 Worker가 새 앱보다 이전이라는 역사적 관측이며, 현재 exact 후보는 기기 미연결로 실기기 네트워크를 재검증하지 못했다. exact schema health·commerce kill switch·100% 집계 로그·5xx/queue 운영 판정도 아직 운영 적용 증거가 아니다. | 필요한 D1 migration·secret을 먼저 적용/readback하고 신규 Worker를 배포한다. 필수 table·column·index exact health 200과 결손 시 503을 확인한 뒤 연결된 A17·razr에서 두 API 404 해소, realtime 상한·요청 부모 전용 audio·구독 퍼널을 재검증한다. T-10/T+30/T+45/T+60 집계와 첫 1시간 5xx 판정, Pages provenance·보안 헤더·실결제 smoke test를 함께 보존한다. |

## 9. 최종 GO 판정 갱신표

v1.3.0 소스 후보의 최종 로컬 전체 재실행은 통과했지만 외부 게이트가 남아 있어 상용 출시 상태는 HOLD다. 실제 증거를 모두 채운 뒤에만 GO로 변경한다.

- [x] 추천 보상 기아 수정 통합 및 backlog 회귀·전체 Worker 테스트 통과
- [x] AI 환불 대사 기아 수정 통합 및 backlog 회귀·전체 Worker 테스트 통과
- [x] Play/Toss 구매 전 reservation·충돌 보상 상태머신 통합 및 자동 교차 결제 회귀 통과
- [x] 가족 단위 교차 provider 1회 체험 claim 통합 및 동시성 회귀 통과
- [x] Toss 환불 기아·재활성화·자연 만료·과거 주문·Google 충돌·삭제 경합·웹훅 ACK 경계 수정 및 독립 회귀 통과
- [x] 위치 확인자료 reciprocal 중복 제거·실측 시각·6개월 보존, 추천 summary-only 판정, 감사 API 완전 페이지네이션 회귀 통과
- [x] AAB schema v4 raw/투영 provenance, archive·TOCTOU와 strict release record fail-closed 통합. `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json`은 verdict `HOLD`·`humanApprovalRequired=true`·blocker 27건을 반환해 외부 증거와 사람의 GO 부재를 정확히 차단
- [x] Toss 복귀 URL `no-referrer`, realtime live 8/user·64/room, legacy raw socket 송신의 인증 API broadcast 전환, Android 등록 장소 master 조회 실패 fail-closed 통합·focused 회귀 통과
- [x] final local production bundle 390×844@2x 부모 42/42·아이 14/14와 가격·Free/Premium·SOS 무료·다운그레이드 보존·장소 업셀/복귀·선생님 gate 검증, 문제·Console·Network 0
- [x] 현재 작업 트리에서 `hyeni-3` 1,231/1,231·typecheck·build와 exact dist 414파일·JS 479,697 bytes·CSS 30,849 bytes 확인
- [x] 현재 sibling 작업 트리에서 `hyeni-1/worker` 1,159/1,159·TypeScript·dry-run과 기존 `hyeni-1` 2,208/2,208·lint/build 확인
- [x] 활성 OpenAI 호출 4개를 `gpt-5.6-luna` 중앙 계약으로 전환하고 로그 안전 계약 11/11·업데이트된 `.env` 키의 live canary 4/4 확인
- [ ] 내부 도구 로그에 노출된 이전 OpenAI 키의 Dashboard 폐기 여부와 production Worker secret 교체·readback을 확인하고, 실제 승인 한국어 알림장 이미지·연령별 아이 대화 안전성·하루 요약 사실성을 승인
- [ ] 변경을 clean commit으로 고정한 뒤 exact app/sibling SHA의 교차 CI run과 동일 결과를 release record에 연결
- [x] v1.3.0 local debug Android 172/172·manifest policy 33/33·lint 오류 0·경고 13·assemble/bundle과 최신 schema v4 provenance·artifact hash 확인. 경고 13건은 사용되지 않는 레거시 리소스와 기존 런처·스플래시 이미지 구성 경고
- [ ] clean CI build→`cap sync`→승인 인증서 서명 release AAB의 schema v4 evidence=현재 dist=Pages provenance release record와 Play 내부 테스트 확인
- [ ] SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873` exact debug APK를 A17 부모·razr 아이에 `adb install -r`로 세션 보존 설치하고 양쪽 vCode 5/v1.3.0, 부모·아이 UI, package-specific Java/native crash·ANR을 확인. 현재는 exact `get-state`와 `adb start-server` 뒤에도 양쪽 `device not found`여서 설치·검증하지 못함
- [ ] 연결된 razr에서 사용자가 잠금 해제한 뒤 현재 후보 foreground UI를 검증하고 네이티브 상태 변경 E2E 완료
- [ ] 신규 Worker+D1 선행 배포·readback 뒤 동일 실기기에서 `/api/realtime/ticket`·`/api/premium-funnel/events` 404를 해소하고 Console/Network 전체 0-error 재검증
- [ ] 아이 Android 네이티브 알림·full-screen intent 정책·백그라운드 위치·마이크와 부모/아이 양방향 E2E 완료
- [ ] 운영자 승인과 복구 자료를 갖춰 중복 `ai_credit_balances` 5행 파괴적 정규화를 수행하고 운영 D1 migration·secret·Worker/Pages 배포 및 exact health/readback 완료
- [ ] Workers Paid 플랜과 운영 DB byte·최근 24시간 `rows_written` 확인, 위치 확인자료 용량 50/70/85% 게이트 승인
- [ ] 실제 iPhone 홈 화면 PWA에서 Service Worker·Web Push·AudioContext와 Toss checkout·복귀 E2E 완료
- [ ] Play와 Toss의 실제 구매·복원·갱신·해지·환불·중복 방지 E2E 완료
- [ ] 최신 공개 약관·개인정보·삭제 안내 배포 및 법률 검토 완료
- [ ] 승인 인증서 서명 release AAB, Play Console/App Signing·Families·법적 선언·16KB page size·대화면·스토어 등록정보를 확인하고 권한 있는 사람이 최종 GO 승인

최종 로컬 통합 수치와 남은 외부 게이트는 다음과 같다.

| 갱신 필드 | 현재 값 |
|---|---|
| 최종 local app | 1,231/1,231, typecheck·production build 통과 |
| 최종 local Worker | 1,159/1,159, TypeScript·Wrangler dry-run 통과 |
| 최종 local legacy app | 2,208/2,208, ESLint·Vite build 통과 |
| OpenAI 생성 모델 | 업데이트된 로컬 `.env` 키로 live verifier 4/4·HTTP 200·응답 model `gpt-5.6-luna`, key/content 출력 0. 이전 키의 Dashboard 폐기 확인·production secret 교체/readback·운영 Worker 배포 전까지 프로덕션 전환 미완료 |
| v1.3.0 local Android 테스트/빌드 | unit 172/172, manifest policy 33/33, lint 오류 0·경고 13(의도된 Capacitor legacy resource 경고) |
| v1.3.0 local debug APK | 13,092,876 bytes · SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873` |
| v1.3.0 local debug AAB | 12,018,080 bytes · SHA-256 `eb0eb5b2288de6771c3e70cc3e5bbe7eaeb3fa62d1f85d1d2ce318748631c2c5` · schema v4 `matched:true` · debug 서명으로 Play 업로드 불가 |
| schema v4 evidence | `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json` SHA-256 `e552dd6655d4e6a0b467cac0d0acba73f5ae9f79a410b657926e1fcd242d0c18` · verification log SHA-256 `1bd78d88dfa4cb717bf4f73d1a8bf116cb653135d01560daa9c472816f0a483f` · source/embedded web `matched:true` · 권한 24개 exact · 16KB ZIP/ELF 정적 검사 통과 |
| strict release record | `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json`: verdict `HOLD` · `humanApprovalRequired=true` · blocker 27건. 양 저장소 dirty, release AAB source SHA·upload certificate·CI·Pages provenance·launch approval 누락, 평문 서명 자격정보 파일 존재 감지. 비밀 파일은 읽거나 수정하지 않음 |
| v1.3.0 final local browser/PWA | exact dist 414파일·tree SHA-256 `21fd847bd3b5e64d71beaa329155d3273ac8d5bfdaa2dc87b24d63356dd6c1e5`, index SHA-256 `c4a51f17136795d0eba64467c77d965614cf5964381b78d1796072be3d8b616a`, JS 479,697 bytes·CSS 30,849 bytes; 브라우저 부모 42/42·아이 14/14, PWA Service Worker runtime 모두 문제 0. 증거는 `artifacts/release-evidence/browser-qa/20260802T141931-final-21fd847/report.json`과 `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`. WebKit smoke PASS지만 offline reload는 Playwright 엔진 오류로 미검증이며 실제 iPhone 증거가 아님 |
| v1.3.0 실기기 | 현재 exact APK는 A17·razr 모두 `device not found`여서 설치·vCode·UI·Java/native crash·ANR을 검증하지 못했다. 이전 SHA-256 `f0c697ecc44f7fbc2443631e62bea7160c6ae436072cead433fce443fb2c1452` 후보의 설치·A17 UI·exit 결과는 역사 증거로만 유지하며 현재 증거로 재사용하지 않는다. S25는 조작하지 않았다. |
| 최종 서명 AAB | 미생성 — 업로드 금지 |
| 운영 방어 | 신규 웹 checkout kill switch fail-closed, exact health 503, 100% privacy-safe aggregate logs, 5xx·queue 추세 판정, Android full-screen intent 정책, strict approval evidence를 로컬 검증. 프로덕션 적용은 미완료 |
| 운영 D1·secret·결제 E2E | migration/deploy/readback, AI balance 중복 정규화 승인, Luna secret·이전 키 폐기, iPhone PWA/Toss·Play 실결제 미완료 |
| 출시 판정 | HOLD — 기계 evidence는 사람의 GO가 아니며 운영·실기기·결제·스토어 증거가 없어 launch-ready/100점 판정 금지 |

### 현재 HOLD를 유지하는 필수 차단 목록

1. 운영 D1 migration을 순서대로 적용하고 신규 Worker를 배포한 뒤 exact health와 신규 API를 readback한다.
2. 중복 `ai_credit_balances` 5행의 파괴적 정규화를 복구 자료와 운영자 명시 승인 아래 수행한다.
3. 프로덕션 Luna secret을 교체·readback하고 이전 OpenAI 키 폐기를 확인한다.
4. 실제 iPhone 홈 화면 PWA에서 Service Worker·Web Push·AudioContext와 Toss 결제를 E2E 검증한다.
5. Google Play와 Toss의 실제 결제·갱신·해지·환불·교차 provider 방지를 E2E 검증한다.
6. A17·razr를 다시 연결해 현재 exact APK를 설치하고 versionCode·UI·exit 증거를 새로 수집한 뒤, razr를 사용자가 잠금 해제한 상태에서 네이티브 상태 변경 경로를 검증한다.
7. 승인 인증서로 release AAB를 만들고 Play Console/App Signing·Families·법적 선언을 완료한 뒤 권한 있는 사람이 최종 GO를 승인한다.

## 10. 출시 후 매출 최대화 운영 원칙

가격은 초기 출시 동안 월 4,900원·연 39,000원을 유지한다. 연간제를 기본 강조하되 월간 선택을 숨기지 않는다. 가격을 다시 바꾸기 전 최소 90일 동안 다음 가족 단위 흐름을 관찰한다.

`가족 생성 → 아이 연결 → 첫 실측 위치 → 첫 도착 → 업셀 노출 → 구독 화면 → 체험 시작 → 활성 결제 → 갱신 → 환불/해지`

의사결정 지표는 설치 수가 아니라 다음으로 제한한다.

- 30일 활성 가족(MAF): 부모 활동과 자녀 신호가 모두 있는 가족
- 맥락별 업셀 노출→구독 화면→체험→결제 전환율
- 월/연 상품별 첫 갱신율과 환불율
- Google Play/Toss별 실제 90일 순매출과 MAF당 순매출
- provider 수수료·확정 환불·AI 변동비·지원비 coverage 완결성
- 추천 가족의 72시간/48시간 자격 통과율과 지급 후 MAF 변화

비용 coverage가 불완전하면 숫자를 추정해 “매출 증가”로 보고하지 않는다. Free 안전 가치를 축소해 단기 전환을 만들거나 SOS를 유료화하지 않는다. 실제 갱신·순매출 자료가 확인될 때만 Family 티어 또는 가격 실험을 별도 설계한다.

출시 직후 운영 판정은 미리 고정한 집계 규칙만 사용한다. 첫 1시간 5xx rollback은 요청 수 대비 5xx가 1%를 **초과**하면서 5xx가 5건 이상일 때만 발동하며, 전체 요청 0건은 성공이 아니라 `INCONCLUSIVE`다. 고정 큐는 T-10/T+30/T+45/T+60 snapshot에서 같은 큐 count가 두 연속 구간 모두 엄격히 증가할 때 `ROLLBACK_REQUIRED`로 판정한다. snapshot 누락·형식 오류·stale·시각 역전은 `INCONCLUSIVE`다. 이 판단에 쓰는 request outcome·cron 로그는 100% 표본의 개인정보 비포함 집계만 허용한다.

결제 장애 때 commerce kill switch는 신규 웹 구독·AI 크레딧 checkout만 닫고 이미 시작된 결제의 완료·대사와 기존 구독의 해지·환불은 유지한다. strict launch approval artifact는 이 규칙과 증거의 무결성을 기계 검증할 뿐 사람의 최종 GO를 대신하지 않는다.

현재 제품 AI 크레딧 원장은 대화 횟수·구매 잔액 원장이지 OpenAI token/원가 원장이 아니다. Luna의 비용 우위는 공식 포지셔닝과 canary 성공만으로 매출로 확정하지 않고, OpenAI 사용량·청구 자료를 `revenue_cost_ledger.ai_variable_cost`와 정기 대사한 뒤 실제 90일 순매출에 반영한다.

## 11. 최종 요약

- 상품 결정: **Free + Premium 두 단계**
- 가격 결정: **월 4,900원 · 연 39,000원**
- 사용자 차이: `tierPolicy` 단일 소스와 구독 비교표·상황형 업셀로 명시
- 결제 채널: Android Google Play + iPhone 홈 화면 PWA Toss
- 추가 매출: AI 30/80/200팩 + 양쪽 가족 AI 10회 추천 보상
- AI 런타임: **로컬 Worker는 OpenAI `gpt-5.6-luna` 단일화·업데이트된 키 live 4/4 완료**, 이전 키 폐기 확인·production secret readback·운영 배포 전에는 프로덕션 완료 아님
- 수익성: 실제 비용 4종과 coverage가 완전할 때만 90일 순매출 계산
- 금융 안전: billing key 원격 폐기, 결제·체험·AI 최소 정본 5년 분리 보존
- 현재 판정: **v1.3.0 소스 후보의 앱 1,231/1,231·Worker 1,159/1,159·legacy 2,208/2,208, 브라우저 부모 42/42·아이 14/14, PWA runtime 문제 0은 통과했다. 그러나 현재 exact APK는 A17·razr 모두 `device not found`여서 설치·버전·UI·exit 증거가 없고, 이전 후보의 실기기 결과는 역사 기록일 뿐이다. WebKit smoke의 offline reload와 실제 iPhone 검증은 미완료이며 debug AAB는 Play 업로드할 수 없다. 운영 D1 25개 필수 객체 중 23개 누락, `ai_friend_limit`·`ai_schedule_limit` source 허용 0, migration·AI balance 정규화 승인·Luna secret/이전 키·iPhone PWA/Toss·Play/Toss 실결제·현재 APK 실기기·서명 AAB/Play/Families/법적/사람 GO가 남았으므로 상용 출시는 HOLD**
