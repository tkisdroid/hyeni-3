# AGENTS.md — 혜니캘린더

가족 일정·부모와 아이의 위치·안전 앱이다. 프로젝트 공통 지침은 이 파일 한 곳에서 관리한다.
아래 참고 문서는 해당 작업에 필요한 항목만 읽고, 과거 이력 전체를 시작 절차로 읽지 않는다.

## 구조와 표현

- 웹 PWA와 Capacitor Android가 앱 소스를 공유한다. Calendar 백엔드는 이 저장소의 `worker/`가 정본이다.
- React·TypeScript·Vite를 사용하며 라우팅은 **HashRouter**다. 버전과 실행 명령은 `package.json`을 따른다.
- 학습 기능은 Calendar의 인증·가족 권한과 Study 서버의 콘텐츠·학습 기록 경계를 유지한다. 별도 로그인을 만들지 않는다.
- 응답·주석·커밋은 한국어다. 앱의 부모·페어링·구독 문구는 존댓말, 아이 모드는 반말이다.
- 스타일은 `src/styles/tokens.css`와 기존 공통 컴포넌트를 사용한다. UI 색상을 hex로 직접 추가하지 않는다.
- 부모 iPhone 홈 화면 PWA에서 아이 Android를 제어하는 흐름을 부모의 Capacitor 여부로 막지 않는다.

## 데이터와 제품 경계

- 아이 선택은 명시적 딥링크 → `useActiveChild()` 순서다. `children[0]` 폴백은 금지하며 전역 아이 전환 UI는 부모 홈에 둔다.
- 일정·준비물·메모 귀속은 `family_members.id`, 위치·기기·부모 알림·원격청취는 auth `user_id`다.
- `DailySupply.child_user_id`는 이름과 달리 member id다. 대상 검증은 `resolveDailySupplyChildMemberId`를 사용한다.
- `date_key`는 월이 0-indexed인 비패딩 형식이다. `src/transform/dateKey.ts`를 사용한다.
- 메모는 아이별 스레드다. 조회·저장·쿼리 키에 아이 member id를 포함하고 다른 아이의 캐시를 재사용하지 않는다.
- 가족·역할·구독·수신자 권한은 서버 정본으로 판정한다. 실패를 성공이나 가짜 기록으로 표시하지 않는다.
- 유료 AI 호출·크레딧 소모·원격 제어는 기존의 명시적 사용자 동작과 동의 경계를 유지한다.

## 실제 계정과 기기

- 실제 계정의 로그아웃·역할 변경·재페어링·refresh 토큰 복사나 회전을 테스트 수단으로 사용하지 않는다.
- A17(`RFKL40DP73J`)은 부모, razr(`ZY22H9VTQD`)은 아이다. 현재 세션을 유지한다.
- S25(`R5CY521CFNZ`)는 고정 역할이 없으므로 역할 의존 작업 전에 현재 역할을 확인한다.
- 설치가 작업에 포함되면 `npm run android:install:debug -- <serial>`을 사용한다. 내부 명령은 `adb install --user 0 -r`이며 앱 데이터·계정·페어링을 보존한다.
- 기기 비밀번호·서명 비밀번호는 사용자가 입력한다. 시크릿·개인정보·토큰 원문은 출력하지 않는다.
- 운영 D1의 파괴적 삭제, 스토어 배포, 시크릿 변경은 별도 명시적 요청 범위에서만 다룬다.

## 작업과 검증

- 요청한 구현과 관련 검증, 발견된 문제 수정까지 이어간다. 로컬 수정·격리 테스트·재시도에 중간 승인을 반복해서 묻지 않는다.
- 기존 수정·미추적 파일을 보존한다. 커밋·푸시·배포·기기 설치는 현재 요청에 포함된 범위로 진행하며 문서 수정만으로 자동 실행하지 않는다.
- 코드 변경에는 해당 앱/Worker 타입 검사와 영향받는 테스트를 사용한다. 번들 영향은 빌드, 화면 변화는 해당 흐름, 네이티브 동작은 필요한 기기 검증으로 확인한다.
- 문서만 바뀌면 링크·명령·관련 문서 계약을 확인한다. 모든 변경에 전체 테스트·운영 D1·실기기 검증을 일괄 요구하지 않는다.
- 같은 규칙을 `AGENTS.md`와 `CLAUDE.md`에 중복 기록하지 않는다. 새로 확인한 재사용 가능한 계약만 해당 참고 문서에 갱신한다.
- 로컬 검증·운영 배포·실기기 확인·Play 제출·공개 게시 상태를 구분해 보고한다.

| 목적 | 명령 |
|---|---|
| 개발 | `npm run dev` |
| 앱 타입·테스트·빌드 | `npm run typecheck`, `npm test`, `npm run build` |
| Worker 타입·테스트 | `npm run typecheck:worker`, `npm run test:worker` |
| 번역·문구 검증 | `npm run i18n:verify` |

Node 테스트는 exit code와 함께 `fail 0` 요약을 확인한다. `tests/**`는 앱 tsconfig 검사 범위 밖이다.
앱 TS를 로드하는 Node 테스트는 `tests/helpers/appModuleResolve.mjs`를 먼저 import한 뒤 대상 파일을 동적으로 import한다.

## 작업별 참고

| 작업 | 참고 |
|---|---|
| 인증·가족·학습·결제·위치·알림·AI 계약 | [기능별 운영 계약](docs/engineering/contracts.md)에서 해당 항목 검색 |
| 화면·토큰·레이아웃·로딩·접근성 | [디자인 구현 참고](docs/engineering/design.md) |
| Android·ADB/CDP·Wrangler·D1·배포 | [기기·운영 참고](docs/engineering/operations.md) |
| Play 출시·롤백 | [출시 체크리스트](docs/store/play-release-checklist.md), [롤백 절차](docs/release/release-day-rollback-runbook.md) |
| 과거 경위·당시 검증 증거가 필요한 경우 | [이전 작업 이력](docs/history/claude-before-astra-20260912.md) |
