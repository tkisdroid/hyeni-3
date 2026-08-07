# 구현 계획: 초기 출시 Free/Premium 수익화 완결

## 목표

혜니캘린더의 초기 출시 요금제를 `Free + Premium` 두 단계로 통일한다. Premium 가격은 월 4,900원·연 39,000원이며, 실제 결제 화면에서는 Android Google Play 또는 iPhone 홈 화면 PWA의 Toss Payments 서버 catalog가 반환한 가격만 정본으로 표시한다. Free 사용자가 일정·소통·기본 위치·기본 장소 알림으로 제품 가치를 충분히 경험하게 하고, Premium은 실시간성·장기 이력·자동화·분석·다자녀로 명확하게 구분한다. 기능 한도에 도달한 순간에는 입력을 잃지 않는 상황형 업셀을 제공한다.

## 확정 제품 계약

### Free

- 자녀 1명
- 일정·반복 일정·준비물·가족 메모·스티커 제한 없음
- 아이가 실제 보고한 최신 위치를 측정시각·정확도와 함께 표시
- 화면 자동 갱신 기준 10분, 즉시 위치 요청 최근 24시간 5회
- 오늘 위치 이력
- 저장 장소 및 도착·출발 알림 2곳
- 위험구역 1곳
- 원격 소리 울리기 최근 24시간 1회
- AI 친구 대화 하루 5회
- SOS·긴급·위험 안전 알림은 항상 제공

### Premium

- 월 4,900원·연 39,000원, 최대 자녀 2명
- Free 기능 전체
- 실시간 위치 갱신과 즉시 위치 요청
- 위치 이력 30일
- 저장 장소·도착/출발 알림·위험구역 제한 없음
- 위치 끊김·미등록 체류·주간/일일 안심 인사이트
- 위급 주변소리 최대 1분, 아이 화면·알림에 계속 고지, 감사 기록 보존
- AI 하루 요약·주간 가족 리포트·학원 시간표
- 원격 소리 울리기 최근 24시간 10회
- AI 친구 대화 하루 20회

### 초기 출시에서 제외

- 별도 Family 상품은 실제 다자녀 분포와 지불의향을 확보한 뒤 추가한다.
- AI 크레딧 팩 가격 변경은 Play 실제 가격과 모델 원가를 확인하기 전까지 하지 않는다.
- 광고 수익화는 도입하지 않는다.

### 기존 reviewed 사용자

- 신규 스토어 방문 혜택 지급을 중단한다.
- 기존 지급 행은 삭제하지 않는다.
- 상업 요금제 화면에서는 Free/Premium 두 열만 표시한다.
- 기존 사용자가 Free 개편으로 기능을 잃지 않도록 호환 보너스를 유지한다.

## 전환 유도 계약

- 둘째 자녀 연결, 장소 3번째 등록, 위험구역 2번째 등록, 즉시 위치 요청 6번째, 원격 소리 울리기 2번째, Premium 리포트/주변소리/AI 요약 진입에서 상황형 업셀을 연다.
- 첫 도착 알림과 실제 데이터가 있는 주간 리포트 미리보기 뒤에도 1회만 가치 기반 제안을 노출한다.
- 업셀은 `dialog` 의미론, 제목 초기 포커스, 포커스 트랩, ESC/Android back 닫기, 닫은 뒤 트리거 복귀를 지원한다.
- 보조 동작은 항상 `무료로 계속 쓰기`이며 기존 폼 입력과 현재 화면을 보존한다.
- 결제 성공 후 원래 행동으로 돌아가되 주변소리는 안전상 사용자가 다시 눌러 시작한다.
- SOS·긴급 알림을 Premium 혜택으로 표현하지 않는다.

## 결제 계약

- Android 네이티브 부모 앱은 Google Play Billing을 사용한다.
- base plan ID는 가격이 아니므로 이름을 가격으로 해석하지 않는다.
- Play Console에서 한국 가격 월 4,900원·연 39,000원과 국가·세금·체험을 확인한다.
- 가격은 `formattedPrice`를 결제 직전 다시 조회해 표시·구매·서버 검증한다.
- 7일 체험은 현재 계정에 eligible인 정확한 7일 무료 offer가 있을 때만 안내한다.
- iPhone 홈 화면 PWA에는 Toss Payments 자동결제 경로를 제공한다. 자동결제 계약·동일 환경 키·필수 D1 migration 중 하나라도 없으면 fail-closed하고 결제를 성공으로 위장하지 않는다.
- Play 배포 Android 앱 안에서는 승인되지 않은 외부 결제 CTA를 노출하지 않는다.

## 퍼널·개인정보 계약

- 이벤트: 업셀 노출, CTA, 결제 시작, 결제 성공/취소/실패, 체험 시작, 갱신, 해지.
- 허용 필드: `PREMIUM_FUNNEL_HASH_SECRET`으로 만든 HMAC-SHA256 가족 가명키, 이벤트 종류, 기능 출처, 플랜, 결제 채널, 앱 버전, 발생시각.
- 금지 필드: 자녀 이름, 위치/주소, 메모·AI 원문, 토큰, 주문번호, 구매 토큰, 이메일·전화번호.
- 분석 이벤트 실패는 사용자의 안전 기능과 결제를 막지 않는다.
- 운영 보관기간은 180일이며 이후 삭제한다.

## 기술 스택과 정본

- 클라이언트: Vite 7, React 19, TypeScript strict, React Router HashRouter, TanStack Query, 플레인 CSS
- Android: Capacitor 8, Google Play Billing 9
- 서버: `C:/Users/TK/Desktop/hyeni-1/worker` Cloudflare Worker, D1, FCM
- 티어 UI 정본: `src/transform/tierPolicy.ts`
- 서버 엔타이틀먼트 정본: Worker 공통 resolver 한 곳으로 통합
- 가격 정본: 결제 공급자의 실제 상품 응답

## 실행 명령

- 클라이언트 전체 테스트: `node --test tests/*.test.*`
- 타입 검사: `npm run typecheck`
- 웹 빌드: `npm run build`
- Worker 타입 검사: `npx tsc --noEmit` (`C:/Users/TK/Desktop/hyeni-1/worker`)
- Worker 전체 테스트: `node --test worker/tests/*.test.mjs` (`C:/Users/TK/Desktop/hyeni-1`)
- Android 단위 테스트: `./gradlew testDebugUnitTest` (`android`)
- Android 빌드: `npm run build && npx cap sync android`, 이후 `./gradlew assembleDebug`
- 설치: `adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk`

## 구현 순서

1. 순수 티어 정책과 테스트를 먼저 변경한다.
2. Worker 공통 엔타이틀먼트와 무료/유료 한도를 맞춘다.
3. 기능별 서버·클라이언트 게이트를 하나씩 수직 슬라이스로 연결한다.
4. 구독 비교 화면과 재사용 가능한 상황형 업셀을 연결한다.
5. 퍼널 계측과 PWA 결제 계약을 추가한다.
6. 전체 정적·런타임 검증 후 허용된 A17 부모 세션만 읽기 전용으로 검증한다. 승인된 아이 Android 실기기 E2E는 별도 출시 게이트로 남긴다.

## 경계

- 항상: 현재 API·DB 스키마 확인, 기존 세션·페어링 보존, refresh token 미조회, 테스트 데이터 원복
- 먼저 확인: 실제 PG 상점 계약·시크릿, Play Console 가격/offer, 운영 D1 migration 적용
- 금지: 가격 하드코딩으로 실제 결제 조건 위장, 라이브 토큰 회전, 기기 역할 전환·로그아웃, 프로덕션 D1 파괴 삭제, 승인 없는 배포

## 완료 기준

- Free/Premium 차이가 모든 진입점과 구독 화면에서 동일하다.
- 클라이언트와 Worker가 같은 한도·엔타이틀먼트를 사용한다.
- 무료 사용자가 핵심 일정·소통·기본 위치·장소 알림을 실제로 사용할 수 있다.
- Premium 기능은 구매 상태가 확인된 가족에만 열린다.
- 상황형 업셀은 접근 가능하고 입력을 보존하며 소스별로 계측된다.
- iPhone PWA에서 부모 원격제어와 결제 경로가 플랫폼 오판 없이 동작한다.
- 전체 테스트·타입 검사·빌드가 통과한다.
- A17 부모 세션은 `install -r`로 보존한 채 읽기 경로를 검증하고, S25·razr에는 이후 추가 접근하지 않는다.
- 승인된 아이 Android, 실결제, 운영 migration·배포 등 외부 게이트는 직접 증거가 확보될 때만 완료 처리한다.

## 운영 의존성

- PWA 정기결제 공급자 계약과 시크릿
- Play Console 한국 가격·base plan·7일 offer 확인
- 운영 D1 migration 승인 및 적용
- A17 ADB `device` 상태. 아이 Android 네이티브 E2E는 별도 승인 환경
