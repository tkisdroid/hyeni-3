export const meta = {
  name: 'wf-build-wave2',
  description: '와이어프레임 Wave2 — hyeni-1 백엔드 엔드포인트 포팅 + 신규화면 실배선(9 도메인 에이전트)',
  phases: [{ title: 'Port', detail: '9개 도메인 병렬 포팅·배선' }],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['created', 'edited', 'endpointsAdded', 'deadButtonsFixed', 'stillDeferred', 'notes'],
  properties: {
    created: { type: 'array', items: { type: 'string' } },
    edited: { type: 'array', items: { type: 'string' } },
    endpointsAdded: { type: 'array', items: { type: 'string' }, description: '포팅한 엔드포인트 "METHOD /api/... → fn명"' },
    deadButtonsFixed: { type: 'array', items: { type: 'string' } },
    stillDeferred: { type: 'array', items: { type: 'string' }, description: '이번에도 못 한 것(사유)' },
    notes: { type: 'string', description: '통합 담당자가 알아야 할 라우트/state/주의점' },
  },
}

const COMMON = [
  '너는 혜니캘린더(React19+TS strict+Vite+플레인CSS토큰+HashRouter+TanStack Query+lucide-react) 백엔드 배선 엔지니어다.',
  '**백엔드는 실재한다(Cloudflare D1/R2 Worker).** "없다"고 판단하지 말고, hyeni-1(C:/Users/TK/Desktop/hyeni-1)의 `worker/routes/*.ts`(서버 계약)와 `src/lib/*.js`(클라 호출 예시)를 Read 해 정확한 path·method·payload·response 를 파악하고, hyeni-3 로 포팅하라.',
  'hyeni-3 API base 는 동일 Worker(https://hyeni-calendar-api.tkisdroid.workers.dev). 포팅 방법: hyeni-3 의 `src/lib/api/client.ts`(apiGet/apiPost/apiPatch/apiDelete)와 기존 `src/lib/api/endpoints/*.ts` 패턴을 따라 endpoint 함수를 추가/신설하고, `src/queries/*` 에 TanStack 훅을 추가한 뒤 화면을 배선한다.',
  '',
  '작업 전 반드시 Read: (1) docs/WIREFRAME-BUILD-CONTRACT.md (2) src/lib/api/client.ts 와 기존 관련 endpoints/*.ts (3) 관련 queries/*.ts (4) 수정할 화면 파일 (5) 지정된 hyeni-1 참조 파일.',
  '',
  '## 규칙',
  '- **파일 소유**: 아래 지정된 파일만 생성/수정. 특히 지정된 endpoints/queries 파일 외 다른 도메인 인프라 파일은 건드리지 말 것. App.tsx(라우트)는 통합 담당자가 배선 — 너는 navigate("경로",{state}) 만.',
  '- endpoint 응답/요청 타입은 hyeni-1 서버 계약(worker/routes)에 맞춰 정확히. snake_case 응답을 그대로 쓰거나 transform 으로 정리.',
  '- 실제로 서버가 없는 극히 일부만 stillDeferred 로. 대부분은 포팅해서 실동작시켜라.',
  '- strict TS(import type·미사용0·button type=button·인라인 --커스텀 금지), 화면별 전용 .css+고유 프리픽스, PushShell 뒤로가기 navigate(-1), 날짜키 @/transform/dateKey, 말투(부모/선생님 존댓말·아이 반말), safe-area.',
  '- 빌드 실행 금지(통합 일괄 빌드). 하지만 TS 가 깨지지 않게 신중히.',
  '',
].join('\n')

const H1 = 'C:/Users/TK/Desktop/hyeni-1'

const TASKS = [
  {
    name: 'schedule-plus',
    prompt: [
      '## 담당: 일정/준비물 풀 계약 포팅',
      '### 소유 인프라: src/lib/api/endpoints/schedule.ts, src/queries/useSchedule.ts',
      '### 소유 화면: src/screens/parent/EventForm.tsx(+css), src/screens/feature/Supplies.tsx(+css), src/screens/parent/ParentCalendar.tsx(+css), src/screens/child/ChildHome.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/events.ts, ' + H1 + '/worker/routes/daily-supplies.ts, ' + H1 + '/src/lib/eventChildAttribution.js, ' + H1 + '/src/lib/scheduleConstants.js',
      '### 할 일',
      '- 이벤트 create/update 에 **아이 다중 배정(events_children/child_user_ids)** · **반복(recurrence)** · **사전알림(reminder)** 필드를 서버 계약대로 포팅. EventForm 의 아이선택/반복/사전알림을 실제 저장·표시(현재 "준비 중"). edit 시 기존 값 pre-fill.',
      '- daily-supplies **DELETE**(항목 삭제) 엔드포인트 포팅 → useDeleteDailySupply 훅 추가. Supplies/ChildHome 에 항목 삭제 UI 실동작. rename 편집모드 복원.',
      '- ParentCalendar 상세 시트에 반복/사전알림/아이배정 실제 표시.',
      '- (사진 첨부 R2 는 storage 엔드포인트가 크면 stillDeferred 가능.)',
    ].join('\n'),
  },
  {
    name: 'location-plus',
    prompt: [
      '## 담당: 위치/위험구역 풀 계약 + 위치설정 화면',
      '### 소유 인프라: src/lib/api/endpoints/location.ts, src/queries/useLocation.ts',
      '### 소유 화면: src/screens/feature/DangerZoneForm.tsx(+css), src/screens/feature/PlaceManager.tsx(+css), (신규)src/screens/feature/LocationSettings.tsx(+css), (신규)src/screens/child/ChildLocationStatus.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/danger-zones.ts, ' + H1 + '/worker/routes/location.ts, ' + H1 + '/worker/routes/saved-places.ts, ' + H1 + '/src/lib/locationConstants.js, ' + H1 + '/src/lib/nativeLocationService.js',
      '### 할 일',
      '- 위험구역 **UPDATE(PATCH /api/danger-zones/:id)** 포팅 → useUpdateDangerZone. DangerZoneForm 편집이 교체(delete+create) 대신 진짜 부분수정. 진입/이탈 알림 플래그가 서버 계약에 있으면 저장.',
      '- LocationSettings(P-31): 위치 권한/백그라운드/수집주기/배터리 예외/보관기간. 서버 저장 필드(notif-settings 또는 location prefs)가 있으면 배선, 네이티브 설정은 @/lib/native/location 로. 없으면 로컬+정직 안내.',
      '- ChildLocationStatus(K-03): 아이 모드에서 내 위치 전송중/꺼짐/권한필요 상태. @/lib/native/location + useChildLocations(본인).',
    ].join('\n'),
  },
  {
    name: 'family-plus',
    prompt: [
      '## 담당: 가족 연결해제/아이생성/아이프로필 + 연결상태화면',
      '### 소유 인프라: src/lib/api/endpoints/family.ts, src/queries/useFamily.ts',
      '### 소유 화면: (신규)src/screens/feature/FamilyConnection.tsx(+css), src/screens/feature/PairingWizard.tsx(+css), src/screens/parent/ChildDetail.tsx(+css), src/screens/feature/ProfileEdit.tsx(+css), (신규)src/screens/child/ChildSettings.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/family.ts, ' + H1 + '/src/lib/auth.js(unpairChild), ' + H1 + '/src/lib/childrenContext.js, ' + H1 + '/src/lib/childSettingRequest.js',
      '### 할 일',
      '- **unpair**(POST /api/family/unpair {family_id, child_user_id}) 포팅 → useUnpairChild. FamilyConnection(P-06): 연결 상태·해제(확인 모달)·공동보호자 초대. co-parent 초대 엔드포인트가 있으면 배선.',
      '- 아이 프로필 저장: 서버 계약(family/profile 또는 child update)으로 ProfileEdit 저장 실동작(이름/캐릭터/색/학년/생일 중 서버 지원 필드). PairingWizard 의 신규 아이 정보도 가능한 만큼 서버 생성.',
      '- ChildSettings(K-10): 아이 설정 — 부모 잠금 항목 표시, 잠금 해제 요청 sendChildSettingRequest 포팅. 반말.',
      '- ParentFamily 연결상태 행은 이미 /family-connection 로 navigate 됨(경로 배선은 통합 담당).',
    ].join('\n'),
  },
  {
    name: 'account-settings',
    prompt: [
      '## 담당: 계정/설정홈/데이터/테마',
      '### 소유 인프라: (신규)src/lib/api/endpoints/account.ts, (신규)src/queries/useAccount.ts',
      '### 소유 화면: (신규)src/screens/parent/ParentAccount.tsx(+css), src/screens/parent/ParentSettings.tsx(+css), (신규)src/screens/feature/DataSync.tsx(+css), (신규)src/screens/feature/ThemeSettings.tsx(+css), (신규)src/screens/feature/TrialLock.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/account.ts, ' + H1 + '/worker/routes/legal.ts, ' + H1 + '/src/lib/accountAuth.js, ' + H1 + '/src/lib/dataExport.js, ' + H1 + '/src/lib/theme.js',
      '### 할 일',
      '- account get/update/**delete(회원 탈퇴)** 포팅 → useAccount/useDeleteAccount. legal(약관/개인정보) 포팅.',
      '- ParentSettings: 실 로그인 사용자(useAuth)로 프로필 표시, 각 설정행 → 신규 화면 navigate(/account,/notification-settings,/location-settings,/theme-settings,/data-sync,/subscription), 개인정보 처리방침 → legal 실 콘텐츠, **회원 탈퇴 확인 모달** → useDeleteAccount.',
      '- ParentAccount(P-30): 프로필 편집·비번변경·계정연동·로그아웃·탈퇴.',
      '- DataSync(P-32): buildFamilyDataExport(클라 집계) 로 내보내기(JSON) · 캐시 비우기(queryClient) · 동기화 상태. ThemeSettings(P-33): @/app/accent + theme 로 라이트/다크·아이별 색 지정(런타임 실동작). TrialLock(S-03): useEntitlement 로 체험 종료·잠금 오버레이.',
    ].join('\n'),
  },
  {
    name: 'notif-feedback',
    prompt: [
      '## 담당: 알림설정/피드백/도착·위험 알림상세',
      '### 소유 인프라: src/lib/api/endpoints/notifications.ts, src/queries/useNotifications.ts, (신규)src/lib/api/endpoints/feedback.ts, (신규)src/queries/useFeedback.ts',
      '### 소유 화면: (신규)src/screens/feature/NotificationSettings.tsx(+css), src/screens/feature/Feedback.tsx(+css), (신규)src/screens/feature/ArrivalAlerts.tsx(+css), (신규)src/screens/feature/DangerAlert.tsx(+css), src/screens/feature/Notifications.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/notif-settings.ts, ' + H1 + '/worker/routes/feedback.ts, ' + H1 + '/worker/routes/parent-alerts.ts, ' + H1 + '/src/lib/notifSettings.js, ' + H1 + '/src/lib/feedback.js',
      '### 할 일',
      '- **notif-settings**(GET/POST /api/notif-settings) 포팅 → NotificationSettings(P-24): 유형별 토글·사전알림·방해금지 실 저장. **feedback**(POST /api/feedback) 포팅 → Feedback 실 전송(별점/카테고리/내용).',
      '- ArrivalAlerts(P-22)·DangerAlert(P-23): useParentAlerts 로 도착/미도착·위험 알림 필터·상세(일정명·장소·시간·거리·아이상태). parent-alerts 삭제 엔드포인트 있으면 Notifications 스와이프 삭제도 배선.',
    ].join('\n'),
  },
  {
    name: 'playdate',
    prompt: [
      '## 담당: 친구찾기/놀이약속(playdate)',
      '### 소유 인프라: (신규)src/lib/api/endpoints/playdate.ts, (신규)src/queries/usePlaydate.ts',
      '### 소유 화면: src/screens/feature/FriendPlay.tsx(+css), src/screens/feature/PlaydateAccept.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/playdate.ts, ' + H1 + '/src/lib/friendPlaydate.js',
      '### 할 일',
      '- playdate 계약 포팅: 후보(candidates), 초대 생성/수락/거절(invites, invites/:id/accept, /decline), pending 초대, 세션(sessions), family-enabled. FriendPlay(아이/부모 발신) "같이 놀자" → createPlaydateInvite 실 전송. PlaydateAccept(P-27) 수락/거절 → accept/decline 실 뮤테이션. 대기/연결됨/해제 상태 표시.',
    ].join('\n'),
  },
  {
    name: 'ai-plus',
    prompt: [
      '## 담당: AI 하루요약/친구설정/크레딧결제',
      '### 소유 인프라: src/lib/api/endpoints/ai.ts, src/queries/useAi.ts',
      '### 소유 화면: (신규)src/screens/feature/DaySummary.tsx(+css), (신규)src/screens/child/AiFriendSetup.tsx(+css), src/screens/feature/AiCredit.tsx(+css), src/screens/child/AiFriendChat.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/ai.ts, ' + H1 + '/src/lib/aiDaySummary.js, ' + H1 + '/src/lib/aiFriendCharacter.js, ' + H1 + '/src/lib/aiChatPersonas.js, ' + H1 + '/src/lib/aiCreditRequest.js',
      '### 할 일',
      '- **day-summary**(GET/POST /api/ai/day-summary) 포팅 → DaySummary(P-28): 일정수행·위치·리워드·안전 종합(프리미엄). **ai settings**(/api/ai/settings/friend, friend-name, chat) 포팅 → AiFriendSetup(K-04): 캐릭터·이름·성격 선택 후 저장하고 대화하기(AiFriendChat 진입). AiFriendChat 은 저장된 페르소나 반영.',
      '- 크레딧 결제(/api/ai/credits/purchase)는 네이티브 결제 게이트라 웹은 "앱에서 결제" 유지 가능 — 단 자동충전/구매 흐름을 hyeni-1 계약대로 정리.',
    ].join('\n'),
  },
  {
    name: 'safety-remote',
    prompt: [
      '## 담당: 소리울리기(force-ring)/SOS수신/원격청취 세션',
      '### 소유 인프라: (신규)src/lib/api/endpoints/remote.ts, src/lib/api/endpoints/sos.ts, (신규)src/queries/useRemote.ts, src/queries/useSos.ts',
      '### 소유 화면: (신규)src/screens/feature/RemoteRing.tsx(+css), (신규)src/screens/feature/SosReceive.tsx(+css), src/screens/feature/RemoteAudio.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/force-ring.ts, ' + H1 + '/worker/routes/remote-listen.ts, ' + H1 + '/worker/routes/sos.ts, ' + H1 + '/worker/routes/push-notify.ts, ' + H1 + '/src/lib/forceRing.js, ' + H1 + '/src/lib/remoteAudio.js, ' + H1 + '/src/lib/sos.js',
      '### 할 일',
      '- **force-ring**(POST /api/push-notify {action:force_ring...}, GET /api/force-ring/active|history|quota) 포팅 → RemoteRing(P-19): 지속시간 선택·지금 울리기(확인 모달)·중지·상태 폴링.',
      '- **remote-listen**(/api/remote-listen/sessions) 포팅 → RemoteAudio 실제 청취 세션 수립(가능 범위; 실 오디오 스트리밍이 과하면 세션 생성/상태까지만 실동작 + 정직 안내).',
      '- SosReceive(P-20): 부모용 SOS 수신 화면 — GET /api/sos/events 로 수신 SOS 상세, 확인 처리, 전화/주변소리/추적 액션.',
    ].join('\n'),
  },
  {
    name: 'teacher-plus',
    prompt: [
      '## 담당: 선생님 시간표/반생성/알림장 첨부',
      '### 소유 인프라: src/lib/api/endpoints/teacher.ts, src/queries/useTeacher.ts',
      '### 소유 화면: src/screens/teacher/TeacherTimetable.tsx(+css), src/screens/teacher/TeacherHome.tsx(+css), src/screens/teacher/TeacherNotice.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/teacher.ts, ' + H1 + '/worker/routes/teacher-write.ts, ' + H1 + '/worker/routes/teacher-notices.ts, ' + H1 + '/worker/routes/academies.ts, ' + H1 + '/src/lib/teacherApi.js, ' + H1 + '/src/lib/teacherBatch.js',
      '### 할 일',
      '- 반 **시간표(class schedule)** 읽기·셀 편집·주 복사 엔드포인트 포팅 → useClassSchedule 등. TeacherTimetable 실데이터+편집.',
      '- **반 생성**(POST /api/teacher/classes) 및 선생님 프로필 보장 포팅 → useCreateClass/useEnsureTeacherProfile. TeacherHome 반 없을 때 반 만들기 실동작.',
      '- TeacherNotice 첨부(R2 storage)가 가능하면 배선, 과하면 stillDeferred.',
    ].join('\n'),
  },
]

phase('Port')

const results = await parallel(TASKS.map((t) => () =>
  agent(COMMON + '\n' + t.prompt, {
    label: 'port:' + t.name,
    phase: 'Port',
    schema: SCHEMA,
    agentType: 'general-purpose',
  })
))

const merged = { created: [], edited: [], endpointsAdded: [], deadButtonsFixed: [], stillDeferred: [], notes: [] }
TASKS.forEach((t, i) => {
  const r = results[i]
  if (!r) { merged.notes.push(t.name + ': (결과 없음)'); return }
  merged.created.push(...(r.created || []))
  merged.edited.push(...(r.edited || []))
  merged.endpointsAdded.push(...(r.endpointsAdded || []))
  merged.deadButtonsFixed.push(...(r.deadButtonsFixed || []))
  merged.stillDeferred.push(...(r.stillDeferred || []))
  if (r.notes) merged.notes.push(t.name + ': ' + r.notes)
})
return merged
