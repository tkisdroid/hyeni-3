/goal

당신은 `/workspace/hyeni-3` 저장소에서 작업하는 코딩 에이전트입니다.

이번 작업의 목표는 혜니캘린더 출시 직전 서비스 품질을 끌어올리는 것입니다.  
새 기능을 무작정 늘리는 것이 아니라, **구독 전환**, **무료/프리미엄 기능 경계**, **부모·아이 사용성**, **민감 기능 신뢰 안내**, **AI 기능 안내**, **에러/빈 상태**, **디자인/애니메이션 완성도**를 출시 가능한 수준으로 정리하세요.

핵심 원칙은 다음입니다.

> 혜니캘린더는 “안전은 무료로 지키고, 프리미엄은 더 자세히 안심하는 앱”이어야 합니다.

따라서 SOS·긴급 알림 같은 생명선 기능은 절대 프리미엄 전용처럼 보이게 만들면 안 됩니다.  
프리미엄은 실시간 위치, 다자녀, 위치 이력, 주변 소리 듣기, AI 하루 요약, 주간 리포트, 일정/장소 무제한 등 **더 촘촘한 안심과 편의**로 포지셔닝하세요.

---

# 0. 현재 확인된 상태 요약

현재 로컬 저장소에서 확인된 HEAD는 `bf6da62`입니다.  
요청자가 언급한 `e09a197` 커밋은 현재 로컬 `git log --all`에서 확인되지 않았습니다. 작업 시작 시 반드시 다시 확인하세요.

현재 코드상 확인된 주요 상태는 다음입니다.

## 0.1 티어 정책

`src/transform/tierPolicy.ts` 기준:

- 티어:
  - `unknown`
  - `free`
  - `reviewed`
  - `premium`
- 아이 등록:
  - 무료/리뷰: 1명
  - 프리미엄: 2명
- 일정 저장:
  - 무료: 1개
  - 리뷰: 3개
  - 프리미엄: 무제한
- 장소 저장:
  - 무료: 1개
  - 리뷰: 3개
  - 프리미엄: 무제한
- 위치 보기:
  - 무료: 잠금
  - 리뷰: 지연 위치
  - 프리미엄: 실시간
- 프리미엄 전용:
  - 실시간 위치
  - 다자녀
  - 주변 소리 듣기
  - AI 하루 요약
  - 학원 시간표
  - 다중 위험구역
  - 이동경로 연장
- 안전 기능:
  - SOS
  - 위험구역 안전 알림
  - 긴급 알림
  - 위 기능은 티어와 무관하게 항상 무료

관련 파일:
- `src/transform/tierPolicy.ts`

## 0.2 구독 화면

`src/screens/feature/Subscription.tsx` 기준:

- 상품:
  - `hyeni_premium`
- 월 base plan:
  - `monthly-2900`
- 연 base plan:
  - `annual-27840`
- 현재 화면 표시:
  - 월 2,900원
  - 연 29,000원
  - 월 2,417원 꼴
- 구독 화면 혜택에 현재 다음 문구가 있음:
  - `실시간 위치 무제한 조회`
  - `안전구역 알림 무제한`
  - `AI 일정 등록 무제한`
  - `SOS 긴급 알림 우선 전송`
  - `프리미엄 스티커 개방`

주의:
- `SOS 긴급 알림 우선 전송`은 정책과 충돌합니다. SOS/긴급 안전 알림은 항상 무료이므로 프리미엄 혜택처럼 보이면 안 됩니다.
- `안전구역 알림 무제한`도 표현을 조심해야 합니다. 안전 알림 자체는 무료지만, 프리미엄에서 다중 위험구역/상세 관리/무제한 장소 등으로 확장되는 식으로 표현해야 합니다.
- `annual-27840`과 화면의 `29,000원`이 불일치합니다. Google Play Console 실제 가격은 저장소만으로 확정할 수 없으므로, 화면 가격을 바꿀지 주석을 정리할지 신중히 판단하세요.

관련 파일:
- `src/screens/feature/Subscription.tsx`
- `src/lib/native/billing.ts`
- `src/transform/tierPolicy.ts`

## 0.3 AI 일정/알림장

`src/screens/feature/AiSchedule.tsx` 기준:

- 탭:
  - 음성
  - 텍스트
  - 알림장
- 사진 선택/미리보기 구현됨.
- 사진 선택만으로 AI 호출하지 않음.
- 사용자가 `AI로 정리하기` 버튼을 눌러야 AI 호출.
- 실패 시 가짜 결과를 만들지 않음.
- 저장 시 activeChild에게 일정 배정.
- `dateToDateKey` 사용.

개선 필요:
- 크레딧 사용 가능성 안내 부족.
- 사진/알림장 탭 이름과 설명을 더 넓고 명확하게 수정 필요.
- 결과 편집 또는 저장 후 수정 안내 부족.
- 무료 한도 초과 시 리뷰 혜택/프리미엄 CTA 부족.

관련 파일:
- `src/screens/feature/AiSchedule.tsx`
- `src/queries/useAi.ts`
- `src/lib/api/endpoints/ai.ts`
- `src/queries/useSchedule.ts`

## 0.4 원격청취

`src/screens/feature/RemoteAudio.tsx` 기준:

- route state childUserId > activeChild 순서로 대상 아이 선택.
- 첫 아이 하드코딩을 피하고 있음.
- 듣기 시작은 사용자 버튼 onClick에서만 실행됨.
- 1분 청취 구조.
- 아이에게 알림이 간다는 문구는 있음.
- 프리미엄/권한/기기 없음 등 일부 에러 분기 있음.

개선 필요:
- 민감 기능인데 투명성 안내가 부족.
- 감사 로그/청취 기록 UI 없음.
- 원격청취 화면 하단에 “청취 기록 보기” CTA 필요.
- 원격청취 감사 로그 화면 골격 필요.
- 청취 시작 전 안내가 더 명확해야 함:
  - 아이에게 알림이 표시됨
  - 1분 후 자동 종료됨
  - 기록이 남음
  - 위급 상황 확인용 기능임

관련 파일:
- `src/screens/feature/RemoteAudio.tsx`
- `src/lib/native/ambient.ts`
- `src/queries/useRemote.ts`
- `src/lib/api/endpoints/remote.ts`
- 추가 후보:
  - `src/screens/feature/RemoteAudioAudit.tsx`
  - `src/screens/feature/RemoteAudioAudit.css`

## 0.5 부모 홈

`src/screens/parent/ParentHome.tsx` 기준:

- activeChild 기준으로 일정/준비물/위치/기기 상태를 구성.
- 기기 상태는 홈 진입 시 1회 `requestDeviceStatus(familyId)` 요청.
- 지금 갱신은 쿼리 refetch 후 성공/실패 토스트 분리.
- 다자녀 카드에서 각 아이 위치/일정을 별도로 계산.

개선 필요:
- 부모가 매일 앱을 열 이유가 부족할 수 있음.
- 부모 홈에 `오늘의 안심 리포트` 카드/CTA 추가 필요.
- 별도 `DailySafetyReport` 화면이 현재 없음.
- 홈 진입 시 자동 기기 상태 요청은 유지하되, 필요하면 쿨다운 또는 안내를 검토.

관련 파일:
- `src/screens/parent/ParentHome.tsx`
- 추가 후보:
  - `src/screens/feature/DailySafetyReport.tsx`
  - `src/screens/feature/DailySafetyReport.css`

## 0.6 아이 홈

`src/screens/child/ChildHome.tsx` 기준:

- AI 친구
- 다음 일정
- 길찾기
- 부모님에게 이야기하기
- 스티커
- 친구랑 놀기
- 부모님 전화
- 오늘 시간표
- 준비물/숙제

개선 필요:
- 아이가 부모에게 원탭으로 상태를 보낼 수 있는 기능이 없음.
- `도착했어`, `출발했어`, `늦을 것 같아`, `데리러 와줘`, `전화해줘`, `배터리 없어` 같은 원탭 상태 공유 필요.
- 서버 변경 없이 기존 메모 스레드에 메시지 보내는 방식으로 구현 가능.

관련 파일:
- `src/screens/child/ChildHome.tsx`
- `src/screens/shared/MemoChat.tsx`
- `src/queries/useMemo.ts`
- memo endpoint 관련 파일

## 0.7 아직 없는 화면

현재 다음 파일은 없는 것으로 확인됨:

- `src/screens/feature/DailySafetyReport.tsx`
- `src/screens/feature/WeeklyFamilyReport.tsx`
- `src/screens/feature/RemoteAudioAudit.tsx`

이번 작업에서는 최소한 `RemoteAudioAudit`은 구현하고, 가능하면 `DailySafetyReport`까지 구현하세요.  
`WeeklyFamilyReport`는 시간이 남으면 프리미엄 preview/잠금 화면으로 추가하세요.

---

# 1. 반드시 먼저 읽을 파일

작업 시작 전에 아래 파일을 반드시 읽고 현재 구조를 파악하세요.

## 1.1 지침 문서

- `/workspace/hyeni-3/AGENTS.md`
- `/workspace/hyeni-3/CLAUDE.md`

## 1.2 앱 구조/라우팅

- `src/app/App.tsx`
- `src/app/AppShell.tsx`
- `src/app/activeChild.tsx`
- `src/app/toast.tsx`

## 1.3 구독/티어/결제

- `src/transform/tierPolicy.ts`
- `src/screens/feature/Subscription.tsx`
- `src/screens/feature/TrialLock.tsx`
- `src/lib/native/billing.ts`
- `src/queries/useEntitlement.ts`
- `src/lib/api/endpoints/subscription.ts`

## 1.4 부모/아이 핵심 화면

- `src/screens/parent/ParentHome.tsx`
- `src/screens/parent/ParentLocation.tsx`
- `src/screens/parent/ParentSettings.tsx`
- `src/screens/child/ChildHome.tsx`
- `src/screens/shared/MemoChat.tsx`

## 1.5 AI/요약/일정

- `src/screens/feature/AiSchedule.tsx`
- `src/screens/feature/AiCredit.tsx`
- `src/screens/feature/DaySummary.tsx`
- `src/queries/useAi.ts`
- `src/lib/api/endpoints/ai.ts`
- `src/queries/useSchedule.ts`
- `src/transform/dateKey.ts`

## 1.6 원격 제어/원격청취

- `src/screens/feature/RemoteAudio.tsx`
- `src/screens/feature/RemoteRing.tsx`
- `src/lib/native/ambient.ts`
- `src/queries/useRemote.ts`
- `src/lib/api/endpoints/remote.ts`

## 1.7 디자인/공통 UI

- `src/styles/tokens.css`
- `src/styles/components.css`
- `src/styles/global.css`
- `src/components/ui/TopBar.tsx`
- `src/components/ui/SectionHeader.tsx`
- `src/components/ui/Loading.tsx`
- `src/lib/assets.ts`

---

# 2. 절대 규칙

## 2.1 언어/말투

- 모든 응답, 주석, 커밋 메시지, PR 본문은 한국어로 작성하세요.
- 기술 용어와 코드 식별자는 원문 유지.
- 앱 문구 톤:
  - 부모/페어링/구독/설정: 존댓말
  - 아이 모드: 반말

예:

- 부모 화면:
  - `아이의 하루를 한눈에 확인해요`
  - `프리미엄으로 더 자세히 확인하세요`
- 아이 화면:
  - `부모님께 보냈어`
  - `도착했어`
  - `조금 늦을 것 같아`

## 2.2 안전/데이터

- 라이브 refresh token 조작 금지.
- 프로덕션 D1 파괴적 삭제 금지.
- 시크릿 변경 금지.
- 스토어 배포 금지.
- 테스트로 만든 데이터나 바꾼 설정은 반드시 원복하거나 최종 보고에 명시.
- 비밀번호는 사용자만 입력.
- 가짜 데이터로 성공처럼 보이게 만들지 마세요.
- 서버 endpoint가 없으면 빈 상태/준비 중/지원 예정으로 정직하게 표시하세요.

## 2.3 비용/위험 기능 자동 실행 금지

아래 기능은 반드시 사용자 버튼 `onClick`에서만 실행하세요.

- 결제
- LLM 호출
- AI 크레딧 소모
- 음성/사진 AI 파싱
- 주변 소리 듣기
- remote-listen
- force_ring
- SOS
- 원격 위치 새로고침
- 권한 요청

자동 실행 금지입니다.

## 2.4 백엔드

- 백엔드는 `hyeni-1` Cloudflare Worker를 그대로 재사용합니다.
- 서버 재구축 전제 금지.
- 앱 단에서 기존 endpoint와 query를 최대한 재사용.
- 서버 endpoint가 부족하면 UI 골격과 빈 상태만 구현하고 최종 보고에 명시.

## 2.5 활성 아이/다자녀 규칙

반드시 지키세요.

- 전역 활성 아이 스위치는 부모 홈에만 둡니다.
- 다른 화면의 대상 아이 우선순위:
  1. 딥링크/route state child override
  2. activeChild
  3. 폴백 없음
- `children[0]` 무조건 폴백 금지.
- 명시적 수신자 선택 화면만 자체 선택 허용.
- 자체 선택 화면의 기본값은 activeChild.

## 2.6 식별자 규칙

반드시 구분하세요.

- events/supplies/memo 귀속:
  - `family_members.id`
  - member id
- location/device/parent_alerts/remote-listen:
  - auth `user_id`
- `DailySupply.child_user_id`는 이름과 달리 member id로 쓰일 수 있으므로 저장값 기준으로 판단.

## 2.7 date_key 규칙

- date_key 직접 조립 금지.
- 반드시 `src/transform/dateKey.ts` 사용.
- 이 프로젝트의 date_key는 월이 0-indexed 비패딩일 수 있음.
- `"YYYY-MM-DD"` 직접 생성 금지.

## 2.8 TypeScript/CSS

- TypeScript strict 준수.
- `import type` 사용.
- 미사용 변수 금지.
- `<button type="button">` 사용.
- 상태는 불변 업데이트.
- CSS에서 hex 직접 사용 금지.
- 색상은 `src/styles/tokens.css` CSS 변수 사용.
- 기존 공통 클래스 우선 사용:
  - `.hy-card`
  - `.hy-press`
  - `.hy-chip`
  - `.hy-topbar`
  - `.hy-content`
  - `TopBar`
  - `SectionHeader`

---

# 3. 구현 우선순위

## P0 — 반드시 완료

1. 구독 화면 문구/혜택/가격 정합성 정리
2. 원격청취 신뢰 안내 강화
3. 원격청취 감사 로그 화면 골격 추가
4. 아이 홈 원탭 상태 공유 추가
5. AI 일정/사진 UX 안내·오류 문구 보강
6. `npm run typecheck`
7. `npm run build`
8. 커밋
9. PR 작성

## P1 — 가능하면 완료

10. 부모 홈 `오늘의 안심 리포트` 카드 추가
11. `DailySafetyReport` 화면 추가
12. 구독/잠금 CTA를 기능별로 세분화
13. 주요 화면 inline hex를 CSS 변수로 일부 정리
14. 주요 애니메이션에 `prefers-reduced-motion` 대응

## P2 — 시간이 남으면 완료

15. `WeeklyFamilyReport` 프리미엄 preview/잠금 화면 추가
16. i18n 씨앗 구조 추가
17. 해외 진출/구독 정책 문서 추가

---

# 4. P0-1 구독 화면 문구/혜택/가격 정합성 정리

## 4.1 목적

출시 전 구독 화면의 신뢰도를 높입니다.

현재 가장 중요한 문제는 **안전 무료 정책과 구독 혜택 문구가 충돌하는 것**입니다.  
SOS와 긴급 알림은 무료인데, 구독 화면에서 프리미엄 혜택처럼 보이면 안 됩니다.

## 4.2 수정 파일

- `src/screens/feature/Subscription.tsx`
- 필요 시:
  - `src/screens/feature/Subscription.css`
  - `src/transform/tierPolicy.ts`
  - `src/lib/native/billing.ts`

## 4.3 혜택 문구 수정

현재 혜택 중 아래 문구는 수정하세요.

### 현재 문제 문구

- `안전구역 알림 무제한`
- `SOS 긴급 알림 우선 전송`

### 수정 방향

SOS/긴급 알림은 무료라는 메시지를 분명히 하세요.

추천 혜택 목록:

```ts
const BENEFITS = [
  {
    t: "실시간 위치 확인",
    s: "아이의 현재 위치와 이동 흐름을 더 빠르게 확인해요",
  },
  {
    t: "다자녀 안심 관리",
    s: "두 아이까지 일정과 위치를 함께 관리해요",
  },
  {
    t: "AI 하루 요약",
    s: "일정·위치·안전 기록을 AI가 정리해 드려요",
  },
  {
    t: "주변 소리 듣기",
    s: "위급할 때 1분 동안 아이 주변 상황을 확인해요",
  },
  {
    t: "일정·장소 무제한",
    s: "학원, 학교, 준비물, 장소를 넉넉하게 등록해요",
  },
] as const;
구독 화면 어딘가에 다음 무료 안전 문구를 반드시 넣으세요.
추천 문구:
SOS와 긴급 안전 알림은 무료로 계속 제공돼요.
프리미엄은 실시간 위치와 AI 요약처럼 더 자세한 안심 기능을 열어드려요.
4.4 히어로 문구 수정
현재:
우리 가족을 더 안전하게, 광고 없이
추천:
실시간 위치와 AI 요약으로 아이의 하루를 더 안심하게 확인하세요
또는:
기본 안전은 무료로, 더 자세한 안심은 프리미엄으로 확인하세요
4.5 CTA 문구 개선
현재:
구독 시작하기
추천:
연간 선택 시:연간으로 더 안심하기

월간 선택 시:월 2,900원으로 시작하기

공통으로 단순화하려면:프리미엄 시작하기

4.6 출시 기념 문구 완화
현재 문구가 있다면:
이후 월 구독은 4,900원으로 인상될 예정이에요
너무 강한 압박 문구입니다. 다음처럼 완화하세요.
추천:
출시 기념으로 월 2,900원에 제공하고 있어요. 가격이 바뀌면 미리 안내드릴게요.
구독은 언제든 해지할 수 있어요.
4.7 가격 정합성 처리
현재 코드에는 다음 상수가 있습니다.
MONTHLY_BASE_PLAN_ID = "monthly-2900"
ANNUAL_BASE_PLAN_ID = "annual-27840"
화면에는:
연 29,000원
월 2,417원 꼴
저장소만으로 Google Play Console 실제 가격을 확정할 수 없습니다.
처리 방법
가능하면 주석을 정리하세요.
추천:
화면 가격은 일단 29,000원 유지.
annual-27840은 base plan ID일 수 있으므로 상수명/주석에 “실제 노출 가격은 Play Console 기준”을 명시.
단, 사용자가 명시적으로 연 27,840원을 원한다고 되어 있지 않으므로 UI 가격을 임의로 27,840원으로 바꾸지 마세요.
예시 주석:
// basePlanId 는 Play Console 식별자이며, 앱 내 표시 가격은 Play Console 실제 가격 정책과 맞춰 관리한다.
export const ANNUAL_BASE_PLAN_ID = "annual-27840";
4.8 비교표 개선
현재 비교표에 있는 항목은 유지하되, 가능하면 아래 항목을 추가하세요.
위치 이력
다자녀
다중 위험구역
일정·장소 무제한
AI 하루 요약
주변 소리 듣기
SOS·긴급 알림은 모든 티어 ✓
추천 비교표:
기능	무료	리뷰 혜택	프리미엄
아이 등록	1명	1명	2명
일정 저장	1개	3개	무제한
장소 저장	1개	3개	무제한
위치 보기	잠금	지연	실시간
위치 이력	—	—	✓
주변 소리 듣기	—	—	✓
AI 하루 요약	—	—	✓
다중 위험구역	—	—	✓
SOS·긴급 알림	✓	✓	✓

주의:
SOS·긴급 알림 행은 safe 강조를 유지하세요.
무료 안전 기능을 프리미엄으로 오해하게 만들지 마세요.
5. P0-2 원격청취 신뢰 안내 강화
5.1 목적
원격청취는 프리미엄 전환 가치가 크지만, 개인정보/아동 보호 관점에서 민감합니다.
출시 전에는 기능 자체보다 투명성 안내가 중요합니다.
5.2 수정 파일
src/screens/feature/RemoteAudio.tsx
src/screens/feature/RemoteAudio.css
5.3 안내 카드 추가
대기 화면에 안내 카드 3개를 추가하세요.
추천 문구:
아이에게 알림이 가요
청취가 시작되면 아이 기기에 알림이 표시돼요.

1분 후 자동 종료돼요
위급 상황 확인을 위한 짧은 청취만 지원해요.

기록이 남아요
가족의 안전과 투명성을 위해 청취 기록을 남겨요.

5.4 버튼/CTA
현재 듣기 시작 버튼은 유지하되, 버튼 위 또는 아래에 짧은 안내를 추가하세요.
추천:
위급할 때만 사용해 주세요.
청취 시작 전 아이 기기에 알림이 전송돼요.
5.5 에러 문구 개선
현재 에러 문구를 더 구체적으로 바꾸세요.
예:
현재:
청취 명령을 전송하지 못했어요

추천:
아이 기기가 오프라인이거나 알림을 받을 수 없어요. 잠시 후 다시 시도해 주세요.

현재:
원격 청취는 프리미엄 구독에서 지원돼요

추천:
주변 소리 듣기는 프리미엄에서 사용할 수 있어요. SOS와 긴급 알림은 무료로 계속 받을 수 있어요.

현재:
연결된 아이 기기를 찾지 못했어요

추천:
연결된 아이 기기를 찾지 못했어요. 아이 앱이 설치되어 있고 로그인되어 있는지 확인해 주세요.

5.6 기능 실행 규칙
이 화면 진입 시 원격청취를 자동 시작하면 안 됩니다.
듣기 시작 버튼 onClick에서만 실행.
감사 로그 화면 진입도 조회/안내만 해야 합니다.
remote-listen 명령 자동 실행 금지.
6. P0-3 원격청취 감사 로그 화면 골격 추가
6.1 목적
민감 기능의 신뢰 확보를 위해 “주변 소리 듣기 기록” 화면을 추가합니다.
서버 endpoint가 없어도 가짜 데이터를 만들지 말고 빈 상태 UI만 제공하세요.
6.2 새 파일
추가하세요.
src/screens/feature/RemoteAudioAudit.tsx
src/screens/feature/RemoteAudioAudit.css
6.3 라우팅
src/app/App.tsx에 PushShell route를 추가하세요.
추천 경로:
/remote-audio-audit
예:
{ path: "remote-audio-audit", element: <RemoteAudioAudit /> },
6.4 진입점
RemoteAudio.tsx 대기 화면 하단에 CTA를 추가하세요.
문구:
청취 기록 보기
6.5 화면 구성
부모 존댓말 사용.
헤더
제목: 주변 소리 듣기 기록
뒤로가기: navigate(-1)
안내 카드
문구:
언제, 어떤 아이의 주변 소리를 확인했는지 기록해요.
가족의 안전과 투명성을 위해 기록을 남깁니다.
빈 상태
서버 endpoint가 없으면 다음 문구를 보여주세요.
아직 표시할 청취 기록이 없어요
청취 기록은 안전 확인을 위해 저장될 예정이에요
6.6 타입 설계
향후 서버 연결을 고려해 타입을 만들어도 됩니다.
interface RemoteAudioAuditItem {
  id: string;
  childName: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  status: "started" | "ended" | "failed";
  reason?: string;
}
주의:
가짜 기록을 넣지 마세요.
실제 endpoint가 없으면 빈 배열로 처리.
“기록이 저장되었습니다” 같은 거짓 문구 금지.
7. P0-4 아이 홈 원탭 상태 공유 추가
7.1 목적
아이가 앱을 감시 도구가 아니라 소통 도구로 느끼게 합니다.
부모는 실시간 안전감을 얻고, 아이는 타이핑 없이 상태를 전할 수 있습니다.
7.2 수정 파일
src/screens/child/ChildHome.tsx
src/screens/child/ChildHome.css
필요 시:src/queries/useMemo.ts
memo endpoint 관련 파일

7.3 UI 위치
아이 홈의 바로 할 수 있어 섹션 근처 또는 그 위에 추가하세요.
추천 섹션 제목:
부모님께 바로 알려줘
설명:
버튼만 누르면 부모님께 보낼게
7.4 버튼 목록
아이 모드이므로 반말 사용.
도착했어
출발했어
늦을 것 같아
데리러 와줘
전화해줘
배터리 없어
7.5 전송 메시지
각 버튼 클릭 시 기존 부모-아이 메모 스레드로 전송하세요.
도착했어 → 나 도착했어!
출발했어 → 나 출발했어!
늦을 것 같아 → 조금 늦을 것 같아
데리러 와줘 → 데리러 와줄 수 있어?
전화해줘 → 전화해줘
배터리 없어 → 배터리가 얼마 없어
7.6 성공/실패 토스트
성공:
부모님께 보냈어
실패:
보내지 못했어. 잠시 후 다시 해줘
7.7 구현 주의
SOS와 혼동되면 안 됩니다.
데리러 와줘, 전화해줘는 일반 메시지입니다.
긴급 상황은 기존 ChildSos를 유지하세요.
메모 전송 childId는 반드시 member id 사용.
현재 아이 본인 member id는 myMember.id를 사용.
자동 전송 금지.
버튼 클릭 시에만 전송.
전송 중 중복 클릭 방지를 하세요.
7.8 선택 사항: 위치 보내기
시간이 있으면 내 위치 보내기 버튼을 추가하세요.
주의:
위치 권한 요청은 버튼 클릭에서만.
기존 MemoChat 위치 공유 로직이 있으면 재사용.
위치 실패 시 정직하게 안내.
리치 메시지 포맷은 기존 [[loc:lat,lng|주소]] 사용.
8. P0-5 AI 일정/사진 UX 안내·오류 문구 보강
8.1 목적
AI 일정 등록은 한국 초등 부모에게 강한 차별점입니다.
출시 전에는 “잘 될 때”보다 “실패했을 때 어떻게 안내하는가”가 중요합니다.
8.2 수정 파일
src/screens/feature/AiSchedule.tsx
src/screens/feature/AiSchedule.css
8.3 탭 이름 개선
현재 알림장 탭을 더 넓은 개념으로 바꾸세요.
추천:
사진
또는:
사진/알림장
설명에서 다음을 포함하세요.
가정통신문
알림장
학원 안내문
준비물 사진
8.4 크레딧 안내 추가
AI 정리 버튼 근처 또는 힌트 영역에 표시하세요.
추천 문구:
AI가 내용을 정리할 때 크레딧이 사용될 수 있어요.
사진은 일정 후보를 찾기 위해 서버로 전송돼요.
주의:
너무 무섭게 쓰지 말고 짧고 명확하게.
8.5 실패 문구 개선
현재 단순 실패 문구를 구체화하세요.
추천:
사진 인식 실패:사진에서 일정을 찾지 못했어요. 날짜와 시간이 잘 보이게 다시 찍어 주세요.

텍스트 파싱 실패:일정을 찾지 못했어요. 날짜와 시간을 조금 더 자세히 적어 주세요.

서버/AI 실패:AI 일정 등록을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.

8.6 결과 편집/수정 안내
현재 결과를 보여준 뒤 이대로 추가하기로 저장하는 흐름입니다.
최소 수정으로 다음 안내를 추가하세요.
추가한 뒤 캘린더에서 수정할 수 있어요.
시간이 있으면 결과 카드에서 제목/날짜/시간을 편집 가능하게 하세요.
하지만 대규모 리팩터가 되면 안내만 추가하고 최종 보고에 후속으로 남기세요.
8.7 한도 초과 안내 개선
현재 무료/리뷰 한도 초과 시 단순히 개수만 안내할 수 있습니다.
추천 문구:
무료 플랜에서는 일정 1개까지 저장할 수 있어요. 리뷰 혜택을 받으면 3개, 프리미엄에서는 무제한으로 저장할 수 있어요.
가능하면 CTA:
프리미엄 보기
또는 리뷰 혜택 화면이 있다면:
리뷰 혜택 확인하기
9. P1 부모 홈 오늘의 안심 리포트 카드 추가
9.1 목적
부모가 매일 앱을 열 이유를 만듭니다.
현재 DaySummary는 AI 하루 요약 중심이고 프리미엄 기능에 가깝습니다.
출시 전에는 무료 사용자도 볼 수 있는 기본 리포트가 필요합니다.
9.2 수정 파일
src/screens/parent/ParentHome.tsx
src/screens/parent/ParentHome.css
가능하면:src/screens/feature/DailySafetyReport.tsx
src/screens/feature/DailySafetyReport.css
src/app/App.tsx

9.3 부모 홈 카드
부모 홈에 카드 추가.
추천 문구:
제목: 오늘의 안심 리포트
설명: 일정, 준비물, 기기 상태를 한눈에 확인해요
CTA: 리포트 보기
보조 문구:
기록이 쌓이면 더 자세히 보여드려요
9.4 라우트
추천 경로:
/daily-report
PushShell에 추가하세요.
9.5 DailySafetyReport 화면 범위
무료에서도 보여줄 항목:
오늘 일정 개수
다음 일정
준비물 완료/남은 개수
기기 상태
오늘 안전 알림 여부
최신 부모-아이 메시지
프리미엄에서 열리는 항목:
실시간 위치
위치 이력
AI 하루 요약
주간 리포트
9.6 빈 상태 문구
아이 없음:연결된 아이가 없어요

일정 없음:오늘 등록된 일정이 없어요

준비물 없음:오늘 챙길 준비물이 없어요

위치 없음:아직 위치 기록이 없어요

기기 상태 없음:기기 상태를 확인하려면 새로고침해 주세요

메모 없음:오늘 주고받은 메시지가 없어요

9.7 주의
activeChild 없으면 children[0] 폴백 금지.
위치/device는 user_id.
일정/준비물/memo는 member id.
기기 상태 요청은 자동 남발 금지.
원격 명령성 새로고침은 버튼 클릭에서만 하는 것이 안전합니다.
10. P1 디자인/애니메이션/접근성 정리
10.1 목적
출시 전 체감 완성도를 높입니다.
10.2 inline hex 정리
현재 주요 화면에 inline hex가 있습니다.
전체를 다 바꾸기 어렵다면 다음 화면만 우선 정리하세요.
Subscription.tsx
RemoteAudio.tsx
AiSchedule.tsx
ChildHome.tsx
원칙:
CSS에서 hex 직접 사용 금지.
src/styles/tokens.css CSS 변수 사용.
이미 존재하는 신호색 의미 유지:민트: 안전
앰버: 주의
레드: 위험/SOS
파랑: 정보

10.3 prefers-reduced-motion
강한 애니메이션이 있는 화면에 대응하세요.
대상:
원격청취 웨이브/펄스
AI 음성 파형
아이 홈 티커/스파클
구독 화면 강조 애니메이션이 있다면 포함
CSS 예시:
@media (prefers-reduced-motion: reduce) {
  .some-animated-class {
    animation: none;
    transition: none;
  }
}
10.4 접근성
주요 CTA에는 명확한 텍스트 또는 aria-label.
아이 홈 원탭 버튼은 시각 아이콘만으로 의미 전달하지 마세요.
원격청취 버튼은 aria-label 유지.
동적 티커는 너무 잦게 바뀌지 않게 조정.
비교표는 table 구조 유지.
11. P2 주간 가족 리포트 프리미엄 preview
시간이 남으면 추가하세요.
11.1 새 파일
src/screens/feature/WeeklyFamilyReport.tsx
src/screens/feature/WeeklyFamilyReport.css
11.2 라우트
추천:
/weekly-report
11.3 무료 사용자
실제 데이터 대신 preview/lock 화면.
문구:
주간 가족 리포트는 프리미엄에서 사용할 수 있어요
이번 주 등하교, 일정, 위치 흐름을 한 번에 정리해 드려요
CTA:프리미엄 보기

11.4 프리미엄 사용자
기존 데이터로 가능한 범위만 표시.
이번 주 일정 수
준비물 체크 수
메모 대화 수
안전 알림 수
데이터 부족 시:아직 분석할 기록이 부족해요

가짜 수치 금지.
12. P2 i18n 씨앗 구조
시간이 남으면 최소 구조만 추가하세요.
12.1 새 파일 후보
src/i18n/messages.ts
src/i18n/useMessage.ts
12.2 주의
전체 앱 문구를 대규모로 옮기지 마세요.
새로 만드는 화면 중심으로만 적용.
locale 변경 UI까지 만들 필요 없음.
예:
export const messages = {
  ko: {
    dailyReportTitle: "오늘의 안심 리포트",
  },
  ja: {
    dailyReportTitle: "今日の安心レポート",
  },
  "zh-TW": {
    dailyReportTitle: "今日安心報告",
  },
  en: {
    dailyReportTitle: "Today’s Safety Report",
  },
} as const;
13. 문구 가이드 최종본
13.1 구독 화면
히어로:
혜니 프리미엄
실시간 위치와 AI 요약으로 아이의 하루를 더 안심하게 확인하세요
무료 안전 안내:
SOS와 긴급 안전 알림은 무료로 계속 제공돼요.
프리미엄은 실시간 위치와 AI 요약처럼 더 자세한 안심 기능을 열어드려요.
가격:
월 2,900원
연 29,000원 · 월 2,417원 꼴
CTA:
프리미엄 시작하기
또는 선택 플랜에 따라:연간으로 더 안심하기
월 2,900원으로 시작하기

해지 안내:
구독은 언제든 해지할 수 있어요.
13.2 위치 잠금
실시간 위치는 프리미엄에서 사용할 수 있어요.
SOS와 긴급 알림은 무료로 계속 받을 수 있어요.
CTA:프리미엄 보기

13.3 원격청취
위급할 때 아이 주변 소리를 1분 동안 확인할 수 있어요.
청취가 시작되면 아이 기기에 알림이 표시돼요.
가족의 안전과 투명성을 위해 기록을 남겨요.
CTA:듣기 시작
청취 기록 보기

13.4 AI 일정 사진
가정통신문이나 알림장 사진을 올려  세요.
AI가 날짜, 시간, 준비물을 찾아드려요.
AI 정리에는 크레딧이 사용될 수 있어요.
실패:사진에서 일정을 찾지 못했어요. 날짜와 시간이 잘 보이게 다시 찍어 주세요.

13.5 아이 홈
섹션 제목:부모님께 바로 알려줘

설명:버튼만 누르면 부모님께 보낼게

성공:부모님께 보냈어

실패:보내지 못했어. 잠시 후 다시 해줘

14. 구현 중 검색 명령
환경 지침상 grep -R, ls -R 사용 금지.
반드시 rg를 사용하세요.
추천 명령:
rg -n "프리미엄|구독|무료|리뷰|SOS|안전|위치|주변 소리|원격|AI 하루|요약" src
rg -n "useMemoThread|memo|sendMemo|reply" src
rg -n "RemoteAudio|remote-audio|remote_listen|ambient" src
rg -n "AiSchedule|voice-parse|parseSchedule|AI로 정리" src
rg -n "tierPolicy|FEATURES|canUse|locationModeFor" src
rg -n "#[0-9A-Fa-f]{3,8}" src/screens src/styles
15. 검증
수정 후 반드시 실행하세요.
npm run typecheck
npm run build
두 명령 모두 exit 0이어야 합니다.
가능하면 추가 확인:
npm run dev
브라우저 또는 실기기에서 다음 화면을 확인하세요.
구독 화면
부모 홈
아이 홈
AI 일정 등록
원격청취
원격청취 감사 로그
오늘의 안심 리포트, 구현했다면
주간 가족 리포트, 구현했다면
퍼셉터블한 UI 변경이므로 가능하면 스크린샷도 남기세요.
다만 환경상 스크린샷이 불가능하면 최종 보고에 사유를 적으세요.
16. 완료 기준
이번 작업은 아래 조건을 만족해야 완료입니다.
구독 화면에서 SOS/안전 알림이 프리미엄 전용처럼 보이지 않음.
가격/base plan 불일치에 대한 주석 또는 UI 정합성이 정리됨.
원격청취 화면에 투명성 안내가 추가됨.
원격청취 감사 로그 화면 골격이 추가됨.
아이 홈에 원탭 상태 공유가 추가됨.
AI 일정/사진 기능에 크레딧/실패/수정 안내가 보강됨.
부모/아이 문구 톤이 맞음.
activeChild 규칙 위반 없음.
user_id/member id 혼동 없음.
date_key 직접 조립 없음.
자동 결제/자동 LLM/자동 원격청취 없음.
가짜 데이터 없음.
npm run typecheck 통과.
npm run build 통과.
변경 사항 커밋 완료.
PR 작성 완료.
17. 커밋
변경 후 커밋하세요.
예:
git status --short
git add .
git commit -m "feat: 출시 전 구독과 신뢰 UX 정리"
커밋 메시지는 conventional commits 형식의 한국어로 작성하세요.
가능한 커밋 메시지:
git commit -m "feat: 구독 안내와 원격청취 신뢰 UX 개선"
git commit -m "feat: 아이 원탭 상태 공유 추가"
git commit -m "fix: 프리미엄 혜택 문구 정합성 보완"
작업 범위가 크면 논리적으로 나눠 커밋해도 됩니다.
18. PR 작성
커밋 후 PR을 작성하세요.
PR 제목 예시:
feat: 출시 전 구독 안내와 신뢰 UX 개선
PR 본문 예시:
## 요약

- 구독 화면의 프리미엄 혜택 문구를 실제 티어 정책과 맞게 정리했습니다.
- SOS와 긴급 안전 알림이 무료로 제공된다는 안내를 추가했습니다.
- 원격청취 화면에 아이 알림, 1분 자동 종료, 기록 안내를 추가했습니다.
- 원격청취 감사 로그 화면 골격을 추가했습니다.
- 아이 홈에 원탭 상태 공유 기능을 추가했습니다.
- AI 일정/사진 인식 화면에 크레딧 안내와 실패 시 다음 행동 안내를 보강했습니다.

## 검증

- npm run typecheck
- npm run build

## 후속

- Google Play Console 실제 연간 가격은 별도 확인이 필요합니다.
- 원격청취 감사 로그 endpoint가 없으면 현재는 빈 상태 UI만 표시합니다.
- 오늘의 안심 리포트/주간 가족 리포트는 구현 범위에 따라 후속 개선이 필요할 수 있습니다.
19. 최종 보고 형식
최종 보고는 한국어로 작성하세요.
반드시 파일 citation을 포함하세요.
형식:
## Summary

- 구독 화면에서 SOS/안전 알림을 무료 안전 기능으로 분리하고, 프리미엄 혜택 문구를 실시간 위치·AI 요약·다자녀 중심으로 정리했습니다. 【F:src/screens/feature/Subscription.tsx†Lx-Ly】
- 원격청취 화면에 투명성 안내와 청취 기록 진입점을 추가했습니다. 【F:src/screens/feature/RemoteAudio.tsx†Lx-Ly】
- 원격청취 감사 로그 화면 골격을 추가했습니다. 【F:src/screens/feature/RemoteAudioAudit.tsx†Lx-Ly】
- 아이 홈에 원탭 상태 공유 버튼을 추가했습니다. 【F:src/screens/child/ChildHome.tsx†Lx-Ly】
- AI 일정 사진 인식 안내와 실패 문구를 보강했습니다. 【F:src/screens/feature/AiSchedule.tsx†Lx-Ly】

## Testing

- ✅ `npm run typecheck`
- ✅ `npm run build`
- ⚠️ `npm run dev` — 장시간 실행 환경이 아니어서 빌드 검증으로 대체
각 테스트/체크 명령 앞에는 반드시 이모지를 붙이세요.
성공: ✅
환경 제약: ⚠️
실패: ❌
20. 미해결/보고해야 할 가능성이 큰 항목
아래 상황이 확인되면 억지 구현하지 말고 최종 보고에 명시하세요.
e09a197 커밋이 로컬에 없음.
Google Play Console 실제 연간 가격 확인 불가.
annual-27840이 실제 가격인지 base plan 식별자인지 저장소만으로 확정 불가.
원격청취 감사 로그 endpoint 없음.
AI 사진 파싱 endpoint가 실제 이미지 분석을 지원하지 않음.
메모 전송 hook이 ChildHome에서 바로 재사용하기 어렵고 리팩터가 필요함.
activeChild가 없을 때 오늘의 리포트 생성 불가.
기기 상태는 on-demand라 자동 갱신을 남발할 수 없음.
주요 화면 inline hex 전체 정리는 범위가 커서 일부만 처리함.
주간 리포트는 전용 endpoint가 없어 preview/lock 화면만 가능함.
가짜 데이터, 임의 성공 토스트, 임의 프리미엄 판정은 금지합니다.
21. 최종 목표
이번 작업의 최종 목표는 단순한 기능 추가가 아닙니다.
부모는:
무료로도 안전 기능이 유지된다는 신뢰를 얻어야 합니다.
프리미엄을 결제하면 무엇이 더 좋아지는지 즉시 이해해야 합니다.
원격청취 같은 민감 기능도 투명하게 관리된다고 느껴야 합니다.
매일 앱을 열 이유를 가져야 합니다.
아이는:
앱을 감시 도구가 아니라 부모님과 소통하는 도구로 느껴야 합니다.
타이핑 없이도 상태를 보낼 수 있어야 합니다.
문구는 반말이고 짧고 쉬워야 합니다.
제품은:
무료 → 리뷰 혜택 → 프리미엄 전환 흐름이 명확해야 합니다.
안전은 무료, 상세 안심은 프리미엄이라는 경계가 흔들리면 안 됩니다.
출시 직전 신뢰/문구/에러/빈 상태 완성도가 기능 수보다 중요합니다.