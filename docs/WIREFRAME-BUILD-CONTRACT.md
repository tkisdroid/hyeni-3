# 와이어프레임 구현 공통 계약

> 설계 기준: 프로젝트 루트 `혜니캘린더 와이어프레임.dc.html` + `CLAUDE.md §7`.
> 모든 구현 에이전트는 이 계약을 반드시 준수한다.

## 스택
React 19 · TS(strict) · Vite · 플레인 CSS(디자인 토큰) · HashRouter · TanStack Query v5 · lucide-react.

## 컨벤션 (CLAUDE.md §7 — 위반 금지)
- **디자인 토큰**: 컴포넌트에 hex 직접 쓰지 말고 `src/styles/tokens.css` CSS 변수 사용. 아이 테마색 `--hy-accent*`. 신호색 고정(민트=안전, 앰버=주의, 레드=SOS/긴급, 파랑=정보).
- **공통 클래스**: `.hy-card .hy-section-head/-icon/-title .hy-press(+--press) .hy-chip .hy-topbar .hy-iconbtn .hy-content .hy-tabbar .hy-toast`.
- **공통 컴포넌트**: `@/components/ui/TopBar`, `@/components/ui/SectionHeader`. 이미지 `asset("경로")`(@/lib/assets). 아이콘 lucide-react. 토스트 `useToast()`(@/app/toast).
- **화면 패턴 정답**: `src/screens/parent/ParentHome.tsx`(+css) 스타일을 따른다.
- **셸**: 탭 화면은 Parent/Child/TeacherShell 하위. 상세/기능 화면은 PushShell 하위 — 헤더에 뒤로가기 `navigate(-1)`.
- **strict TS**: `import type` 필수, 미사용 변수/import 금지, 인라인 style에 `--커스텀변수` 금지(press 효과는 className `hy-press` + CSS `--press`), 모든 `<button type="button">`.
- **말투**: 부모·페어링·구독·선생님 = 존댓말. 아이(아이모드) = 반말.
- **불변성**: 상태 업데이트는 spread로 새 객체(뮤테이션 금지).
- **safe-area**: 화면 최하단 고정 요소/여백은 `calc(... + env(safe-area-inset-bottom, 0px))`. sticky 헤더 상단은 `calc(env(safe-area-inset-top, 0px) + Npx)`. 하단 입력/CTA가 탭바(≈90px)에 가리지 않게 한다.
- 화면마다 전용 `.css` 파일 분리, 클래스 프리픽스는 화면별 고유하게(예: `.ef-*`).

## 데이터/훅 (컴포넌트는 `@/queries/*` 훅만 사용 — endpoints 직접 호출 금지)
- 일정: `useEvents` `useDailySupplies(dateKey?)` `useCreateEvent` `useUpdateEvent` `useDeleteEvent` `useUpsertDailySupply` (`@/queries/useSchedule`)
- 위치: `useChildLocations` `useLocationHistory` `useDangerZones` `useSavedPlaces` `useCreateDangerZone` `useDeleteDangerZone` `useCreateSavedPlace` `useDeleteSavedPlace` (`@/queries/useLocation`)
- 가족: `useMyFamily` `useUpdateProfile` `useRegeneratePairCode` (`@/queries/useFamily`); `setupFamily`(children 배열 지원) (`@/lib/api/endpoints/family` — 온보딩류만)
- 선생님: `useTeacherMe` `useTeacherClasses` `useRoster(classId)` `useAttendance(classId,dateKey)` `usePublishNotice` `useSetAttendance` `useRequestPairing` (`@/queries/useTeacher`)
- 알림: `useParentAlerts(limit)` `useMarkAlertRead` (`@/queries/useNotifications`)
- 스티커: `useStickerSummary` `useReceivedStickers` `useSendSticker` (`@/queries/useStickers`)
- 메모: `useMemoThread` `useSendMemo` `useMarkRead` (`@/queries/useMemo`)
- SOS: `useSendSos` (`@/queries/useSos`)
- AI: `useAiCredits` `useAiMessages` `useSendChildChat` `useParseSchedule` (`@/queries/useAi`)
- 구독: `useEntitlement` (`@/queries/useEntitlement`)
- 경로: `useWalkingRoute(origin,dest)` (`@/queries/useRoute`)
- 날짜키: **반드시** `@/transform/dateKey`의 `dateToDateKey`/`dateKeyToDate` 경유(월 0-index 비패딩 함정).
- 인증: `useAuth()`(@/auth/AuthContext) — `status`, `userId`, `familyId`, `role`.
- 네이티브: `@/lib/native/*`(phone/browser/push/location/ambient) — 웹 폴백 포함.

## 백엔드 없는 액션 처리 원칙 (중요)
서버 엔드포인트가 없는 액션은 "동작 없는 공허한 토스트"를 남기지 말 것. 다음 순서로 정직 처리:
1. 실제 가능한 근접 동작이 있으면 수행(예: 실 네이티브 전화 `placePhoneCall`, 관련 실 화면으로 navigate).
2. 로컬에서만 의미 있으면 낙관적 반영 + "이 기기에만 저장돼요/미리보기" 명시.
3. 정말 불가하면 버튼 `disabled` + **무엇이** 준비 중인지 한 줄 안내(공허한 "곧 제공돼요" 금지).
백엔드 부재 목록: 연결해제(unpair)·알림설정 서버저장·피드백 전송·아이 프로필 서버저장·하루요약 생성·데이터 동기화·per-child 테마 서버저장·친구요청(friend_requests)·공동보호자 SMS 초대·소리울리기/SOS수신 푸시·위치 백그라운드 설정 서버저장·R2 사진 업로드.

## 라우트 계약 (경로 문자열 그대로 사용 — App.tsx 배선은 통합 담당자가 함)
PushShell(탭바 없음, 헤더 뒤로가기):
- `/event-form` (P-09 일정 생성·수정; `navigate("/event-form",{state:{mode,event?,dateKey?}})`)
- `/child-detail` (P-03 아이 상세; `state:{childId}`)
- `/pairing-wizard` (P-04 페어링 위저드)
- `/family-connection` (P-06 연결 상태·해제)
- `/supplies` (P-13 숙제·준비물; `state:{dateKey?}`)
- `/danger-zone-form` (P-17 위험구역 추가·편집; `state:{zone?}`)
- `/location-status` (P-15 위치 갱신 상태)
- `/account` (P-30 계정·프로필)
- `/notification-settings` (P-24 알림 설정)
- `/location-settings` (P-31 위치·백그라운드)
- `/data-sync` (P-32 데이터·동기화)
- `/theme-settings` (P-33 테마·색상)
- `/trial-lock` (S-03 체험 종료·잠금)
- `/teacher/notice` (T-03 알림장·공지 작성)
- `/remote-ring` (P-19) · `/sos-receive` (P-20) · `/arrival-alerts` (P-22) · `/danger-alert` (P-23) · `/day-summary` (P-28)
- `/child/location-status` (K-03) · `/child/ai-friend-setup` (K-04) · `/child/settings` (K-10)

TeacherShell(탭):
- `/teacher/timetable` (T-02 반 시간표 — 기존 `/teacher/calendar` placeholder 대체)

기존 라우트(이동 대상으로 사용 가능): `/parent/home calendar location memo settings` `/child/home sticker memo` `/teacher/home students` `/child-invite`(초대코드·QR) `/route`(도보경로) `/ai-schedule` `/place-manager` `/place-form` `/remote-audio` `/subscription` `/notifications` `/sticker-send` `/child/sos` `/child/ai-friend` `/onboarding`.
