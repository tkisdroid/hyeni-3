export const meta = {
  name: 'wf-error-audit',
  description: '주요기능 저해 에러 전수 감사 — 8개 도메인 병렬(실동작 에러만, 검증 후 보고)',
  phases: [{ title: 'Audit', detail: '8개 도메인 병렬 감사' }],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'issue', 'file', 'line', 'severity', 'failureScenario', 'fix'],
        properties: {
          area: { type: 'string', description: '화면/기능' },
          issue: { type: 'string', description: '한 줄 결함' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['high', 'med', 'low'], description: 'high=주요기능 실동작 차단' },
          failureScenario: { type: 'string', description: '어떤 입력/상태 → 어떤 실패' },
          fix: { type: 'string', description: '수정 방법 한 줄' },
        },
      },
    },
  },
}

const COMMON = [
  '너는 혜니캘린더(React19+TS strict+Vite+HashRouter+TanStack Query+플레인CSS토큰+lucide-react, 백엔드=Cloudflare Worker) 코드 감사자다.',
  '목표: **주요 기능의 실동작을 저해하는 에러**만 정밀하게 찾아 보고한다. 화면을 실제로 Read 하고, 데이터 흐름(컴포넌트→queries 훅→endpoints→client→Worker)을 추적하라.',
  '',
  '## 찾을 것(실동작 저해 = high/med)',
  '- 런타임 크래시 위험: null/undefined 역참조(예: data 로딩 전 .map/.length, location.state 미가드, 옵셔널 체이닝 누락).',
  '- 데이터가 안 흐르는 배선: 쿼리 enabled 조건 오류·필요 param 미전달·잘못된 queryKey·await 누락·mutation 미실행·잘못된 엔드포인트 경로/HTTP메서드/payload 필드명.',
  '- 버튼/액션이 에러나거나 아무 것도 안 함(잘못된 navigate 경로, 존재하지 않는 라우트로 이동, 핸들러 예외).',
  '- date_key 함정(월 0-index 비패딩) 미준수로 잘못된 날짜.',
  '- 인증/가드 오류로 화면 접근 불가·무한 리다이렉트.',
  '- 타입은 통과하나 논리버그(잘못된 필드 매핑, 뒤바뀐 조건, off-by-one).',
  '- 엔타이틀먼트/티어 게이트가 ready=false(미확정)에서 잘못 잠그거나 강등(R9 위반).',
  '',
  '## 제외(보고 금지)',
  '- 순수 스타일/여백/문구 취향, 이미 정직 처리된 "준비 중"(서버 미지원), 성능 미세 최적화.',
  '',
  '## 방법',
  '- 담당 화면 파일 + 대응 queries 훅 + endpoints 를 Read 로 열어 실제로 확인. 추측 금지 — 코드 근거(file:line) 있는 것만.',
  '- 의심되면 client.ts / 해당 endpoint 의 실제 경로·payload 와 대조. hyeni-1(C:/Users/TK/Desktop/hyeni-1)의 worker/routes 나 src/lib 로 계약을 교차확인해도 됨.',
  '- severity: high=주요기능(로그인·가족·일정·위치·채팅·안전·아이정보) 실동작 차단, med=일부 상황 실패/부분동작, low=경미.',
  '- 수정은 하지 마라(감사 전용). 발견만 구조화해 반환.',
  '',
].join('\n')

const GROUPS = [
  { name: 'auth-onboarding', files: 'src/screens/onboarding/Onboarding.tsx, src/auth/*, src/lib/api/endpoints/auth.ts, src/lib/api/session.ts, src/app/App.tsx(라우트·가드)' },
  { name: 'family-childinfo', files: 'src/screens/parent/ParentFamily.tsx, src/screens/parent/ChildDetail.tsx, src/screens/feature/ProfileEdit.tsx, src/screens/feature/PairingWizard.tsx, src/screens/feature/ChildInvite.tsx, src/screens/feature/FamilyConnection.tsx, src/lib/api/endpoints/family.ts, src/lib/api/endpoints/childPhoto.ts, src/queries/useFamily.ts, src/transform/{familyView,pairLink}.ts' },
  { name: 'schedule', files: 'src/screens/parent/{ParentCalendar,EventForm,ParentHome}.tsx, src/screens/feature/{AiSchedule,Supplies}.tsx, src/screens/child/ChildHome.tsx, src/lib/api/endpoints/{schedule,ai}.ts, src/queries/{useSchedule,useAi}.ts, src/transform/{scheduleView,dateKey}.ts' },
  { name: 'location-safety', files: 'src/screens/parent/ParentLocation.tsx, src/screens/feature/{RouteView,PlaceManager,PlaceForm,DangerZoneForm,LocationStatus,RemoteAudio,RemoteRing,SosReceive}.tsx, src/screens/child/{ChildSos,ChildLocationStatus}.tsx, src/lib/api/endpoints/{location,route,sos,remote}.ts, src/queries/{useLocation,useRoute,useSos,useRemote}.ts, src/components/KakaoMap*, src/lib/native/location.ts' },
  { name: 'chat-stickers-aifriend', files: 'src/screens/shared/MemoChat.tsx, src/screens/feature/{StickerSend,AiCredit,DaySummary}.tsx, src/screens/child/{StickerBook,AiFriendChat,AiFriendSetup}.tsx, src/lib/api/endpoints/{memo,stickers,ai}.ts, src/queries/{useMemo,useStickers,useAi}.ts, src/queries/useFamilyRealtime.ts, src/realtime/*' },
  { name: 'notify-subs-settings', files: 'src/screens/feature/{Notifications,NotificationSettings,ArrivalAlerts,DangerAlert,Subscription,TrialLock,DataSync,Feedback,AiCredit}.tsx, src/screens/parent/{ParentSettings,ParentAccount}.tsx, src/lib/api/endpoints/{notifications,subscription,account,reviewReward,feedback}.ts, src/queries/{useNotifications,useEntitlement,useAccount,useReviewReward,useFeedback}.ts, src/transform/{entitlement,tierPolicy}.ts' },
  { name: 'child-mode-playdate', files: 'src/screens/child/{ChildHome,ChildSos,ChildSettings,ChildLocationStatus}.tsx, src/screens/feature/{FriendPlay,PlaydateAccept}.tsx, src/lib/api/endpoints/playdate.ts, src/queries/usePlaydate.ts, src/app/{NativeBootstrap,accent,toast}.tsx' },
  { name: 'teacher', files: 'src/screens/teacher/{TeacherHome,TeacherStudents,TeacherNotice,TeacherTimetable}.tsx, src/lib/api/endpoints/teacher.ts, src/queries/useTeacher.ts, src/transform/teacherView.ts' },
]

phase('Audit')
const results = await parallel(GROUPS.map((g) => () =>
  agent(
    COMMON + '\n## 담당 도메인: ' + g.name + '\n### 감사 파일(Read 필수; Grep/Glob 로 관련 파일 보강 가능)\n' + g.files,
    { label: 'audit:' + g.name, phase: 'Audit', schema: SCHEMA, effort: 'high', agentType: 'general-purpose' },
  )
))
const merged = []
results.filter(Boolean).forEach((r) => { if (r && r.findings) merged.push(...r.findings) })
merged.sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.severity] - { high: 0, med: 1, low: 2 }[b.severity]))
return { total: merged.length, high: merged.filter((f) => f.severity === 'high').length, findings: merged }
