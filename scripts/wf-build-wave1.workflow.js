export const meta = {
  name: 'wf-build-wave1',
  description: '와이어프레임 구현 Wave1 — 기존 훅으로 죽은버튼 실배선 + 핵심 신규화면(6 에이전트)',
  phases: [{ title: 'Build', detail: '6개 영역 병렬 구현' }],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['created', 'edited', 'deadButtonsFixed', 'deferredToWave2', 'notes'],
  properties: {
    created: { type: 'array', items: { type: 'string' }, description: '새로 만든 파일 경로' },
    edited: { type: 'array', items: { type: 'string' }, description: '수정한 파일 경로' },
    deadButtonsFixed: { type: 'array', items: { type: 'string' }, description: '실동작으로 살린 버튼 라벨' },
    deferredToWave2: { type: 'array', items: { type: 'string' }, description: '신규 엔드포인트가 필요해 Wave2로 미룬 세부(정직 처리해 둔 것)' },
    notes: { type: 'string', description: '통합 담당자가 알아야 할 특이사항(라우트 state 형태, 주의점 등)' },
  },
}

const COMMON = [
  '너는 혜니캘린더(React19+TS strict+Vite+플레인CSS토큰+HashRouter+TanStack Query+lucide-react) 구현 엔지니어다.',
  '작업 전 반드시 아래를 Read 하라: (1) docs/WIREFRAME-BUILD-CONTRACT.md (공통 계약·라우트표·훅목록·컨벤션) (2) src/screens/parent/ParentHome.tsx 와 그 .css (화면 패턴 정답) (3) 네가 수정할 기존 파일 전부 (4) 사용할 queries 훅 파일.',
  '설계 세부(레이아웃/문구)는 프로젝트 루트 "혜니캘린더 와이어프레임.dc.html" 의 해당 화면 섹션을 grep 해 참고하라(선택).',
  '',
  '## 이번 웨이브 규칙',
  '- **기존 queries 훅만 사용**(계약서 목록). 신규 엔드포인트/훅을 만들지 말 것. 신규 엔드포인트가 필요한 세부는 정직한 한 줄 안내로 두고 deferredToWave2 에 적어라(공허한 "곧 제공돼요" 토스트 금지 — 무엇이 준비 중인지 명시).',
  '- **파일 소유**: 아래 지정된 파일만 생성/수정하라. 다른 파일(특히 App.tsx, 다른 화면, 공유 endpoints/queries)은 절대 수정하지 말 것. 라우트 배선(App.tsx)은 통합 담당자가 한다 — 너는 navigate("경로", {state}) 만 호출.',
  '- strict TS 준수: import type, 미사용 import/변수 0, 인라인 style에 --커스텀 금지, 모든 button type="button". 빌드 깨지지 않게.',
  '- 각 신규 화면은 전용 .css 파일 + 고유 클래스 프리픽스. PushShell 상세화면은 헤더 뒤로가기 navigate(-1).',
  '- 날짜키는 @/transform/dateKey 경유(월 0-index 함정).',
  '- 말투: 부모/선생님=존댓말, 아이모드=반말. safe-area 하단/상단 처리.',
  '- 실제로 파일을 열어 확인한 사실에 근거해 구현하라. 빌드는 실행하지 마라(통합 담당자가 일괄 빌드).',
  '',
].join('\n')

const TASKS = [
  {
    name: 'calendar-crud',
    prompt: [
      '## 담당: 일정 CRUD (P-07/P-08/P-09/P-12)',
      '### 생성',
      '- src/screens/parent/EventForm.tsx (+.css) — 일정 생성·수정 폼(P-09). location.state = {mode:"create"|"edit", event?, dateKey?}. 필드: 제목(필수)·아이 다중선택(useMyFamily 의 role="child" 멤버)·날짜·시간(필수)·카테고리(school/sports/hobby/family/friend/other)·장소(텍스트)·반복(없음/매일/매주/매월)·사전알림(없음/10분/30분/1시간)·메모. 저장: create→useCreateEvent, edit→useUpdateEvent(@/queries/useSchedule). date_key 는 dateToDateKey. 제목·시간 필수 검증, 저장중 상태, 성공 토스트 후 navigate(-1). 실패 토스트.',
      '### 수정',
      '- src/screens/parent/ParentCalendar.tsx (+.css) — (1) + FAB onClick → navigate("/event-form",{state:{mode:"create",dateKey:선택일키}}) (현재 토스트만: 라인 근처). (2) 선택일 일정 카드 onClick → 화면 내 바텀시트(P-08 일정 상세: 제목·아이·시간·반복·장소·사전알림·메모 표시) 열기, 시트에 [수정]→navigate("/event-form",{state:{mode:"edit",event}}) · [삭제]→확인 후 useDeleteEvent(P-12). 시트는 오버레이+드래그/탭아웃 닫기. (3) 셀 점 3개 초과 시 +N 배지.',
      '### 훅: useEvents, useCreateEvent, useUpdateEvent, useDeleteEvent, useMyFamily, @/transform/dateKey. (event 객체 필드 형태는 useSchedule.ts + endpoints/schedule.ts + transform/scheduleView.ts 를 Read 해 정확히 맞춰라.)',
    ].join('\n'),
  },
  {
    name: 'supplies-home',
    prompt: [
      '## 담당: 숙제·준비물(P-13) + 부모/아이 홈 실배선',
      '### 생성',
      '- src/screens/feature/Supplies.tsx (+.css) — 숙제·준비물 화면(P-13). location.state={dateKey?}(기본 오늘). useDailySupplies(dateKey) 로 항목 읽기, useUpsertDailySupply 로 체크 토글·항목 추가. 준비물/숙제 구분 섹션, 체크박스, + 추가 입력. 부모·아이 공용(말투는 role 로 분기: 부모 존댓말/아이 반말). (useSchedule.ts + endpoints/schedule.ts 의 daily-supplies 계약을 Read 해 정확히.)',
      '### 수정',
      '- src/screens/parent/ParentHome.tsx (+.css) — (1) 준비물·숙제 "편집" 버튼 → navigate("/supplies") (현재 토스트만). (2) 준비물 체크 토글(togglePrep 로컬상태만) → useUpsertDailySupply 로 실제 서버 반영. (3) "꾹 하트" 버튼 → navigate("/sticker-send") (실 스티커 흐름). 홈의 준비물 섹션 데이터도 useDailySupplies 실데이터로.',
      '- src/screens/child/ChildHome.tsx (+.css) — 준비물/숙제 체크 토글·+추가(현재 로컬 childPrepSeed 상태만) → useUpsertDailySupply/useDailySupplies 로 실 서버 양방향 반영. "다 했어요" 류 CTA 있으면 실동작.',
      '### 훅: useDailySupplies, useUpsertDailySupply, useMyFamily, useEvents, useStickerSummary(있으면). 사진 첨부(R2)는 deferredToWave2.',
    ].join('\n'),
  },
  {
    name: 'location-safety',
    prompt: [
      '## 담당: 위치·안전 실배선 + 위험구역/갱신상태 화면',
      '### 생성',
      '- src/screens/feature/DangerZoneForm.tsx (+.css) — 위험구역 추가·편집(P-17). location.state={zone?}. 이름·중심좌표(현재 지도 컴포넌트 @/components/KakaoMap 또는 PlaceForm 패턴 재사용해 핀 선택)·반경 슬라이더·진입/이탈 알림 토글. 저장→useCreateDangerZone. (endpoints/location.ts + useLocation.ts 의 danger-zone 계약 Read.)',
      '- src/screens/feature/LocationStatus.tsx (+.css) — 위치 갱신 상태(P-15): 갱신중/성공/실패(재시도)/권한필요 4상태. useChildLocations + refetch. 마지막 known 위치+시각 유지 안내.',
      '### 수정',
      '- src/screens/parent/ParentLocation.tsx (+.css) — (1) 자녀 전환 칩(pl-chip): 다자녀면 onClick 으로 선택 자녀 전환(현재 onClick 없음, 첫 자녀 고정). (2) 하단 액션에 "🧭 경로" 버튼 추가 → navigate("/route"). (3) 갱신 실패/권한 상태 안내(LocationStatus 로 이동 또는 인라인).',
      '- src/screens/feature/PlaceManager.tsx (+.css) — 위험구역 섹션에 추가 버튼 → navigate("/danger-zone-form"), 각 위험구역 삭제 → useDeleteDangerZone. (헤더 + 버튼은 저장장소용 유지.)',
      '- src/screens/feature/RouteView.tsx — "안내 시작" 버튼(현재 토스트만) → @/lib/native/browser 로 외부 지도 길안내 열기(웹은 새 탭). 불가하면 정직 안내.',
      '- src/screens/feature/RemoteAudio.tsx — "전화" 버튼(현재 토스트만) → @/lib/native/phone 의 실 발신(placePhoneCall 등, 부모 전화번호는 useMyFamily). 아이 이름/장소 하드코딩(지우/해든타워)을 useMyFamily+useChildLocations 실데이터로. 실제 원격청취 세션 배선은 deferredToWave2.',
      '### 훅: useChildLocations, useDangerZones, useSavedPlaces, useCreateDangerZone, useDeleteDangerZone, useMyFamily, useWalkingRoute. 네이티브 @/lib/native/*.',
    ].join('\n'),
  },
  {
    name: 'family-pairing',
    prompt: [
      '## 담당: 아이 상세(P-03) + 페어링 위저드(P-04) + 아이목록',
      '### 생성',
      '- src/screens/parent/ChildDetail.tsx (+.css) — 아이 상세 허브(P-03). location.state={childId}. useMyFamily 에서 해당 child 찾아 프로필·오늘 요약(useEvents)·안전상태 표시 + 바로가기 CTA: 📍실시간위치→navigate("/parent/location") · 🗓캘린더→navigate("/parent/calendar") · 💬채팅→navigate("/parent/memo") · ⭐스티커→navigate("/sticker-send") · 🔊주변소리→navigate("/remote-audio") · 프로필 편집→navigate("/profile-edit"). 존댓말.',
      '- src/screens/feature/PairingWizard.tsx (+.css) — 페어링 위저드(P-04). 3단계: (1)아이 수 선택 (2)아이 정보(이름·생일·학년·색상 선택; 사진 업로드는 deferredToWave2) (3)코드 만들기. 필수값 검증 후 다음 활성. 마지막에 navigate("/child-invite") 로 초대코드·QR 화면으로. (신규 child 레코드 서버 생성 엔드포인트는 deferredToWave2 — 위저드에서 모은 정보는 state 로 넘기거나 안내.)',
      '### 수정',
      '- src/screens/parent/ParentFamily.tsx (+.css) — (1) 아이 카드 onClick: navigate("/profile-edit") → navigate("/child-detail",{state:{childId:그 아이 id}}) 로 교정. (2) "아이 추가하기" → navigate("/pairing-wizard"). (3) 연결 상태 행/버튼 → navigate("/family-connection") (해당 화면은 Wave2 생성; 경로만 사용).',
      '### 훅: useMyFamily, useEvents, useRegeneratePairCode. 연결 해제(unpair)·공동보호자 초대는 deferredToWave2.',
    ].join('\n'),
  },
  {
    name: 'teacher',
    prompt: [
      '## 담당: 선생님 모드 실배선(T-01~T-04)',
      '먼저 hyeni-1 참조를 Read 해 계약 파악: C:/Users/TK/Desktop/hyeni-1/src/lib/teacherApi.js, teacherNotices.js, teacherBatch.js, C:/Users/TK/Desktop/hyeni-1/worker/routes/teacher.ts, teacher-notices.ts, teacher-write.ts. 그리고 hyeni-3 의 endpoints/teacher.ts + queries/useTeacher.ts 를 Read.',
      '### 생성',
      '- src/screens/teacher/TeacherNotice.tsx (+.css) — 알림장·공지 작성(T-03). 내용·준비물·첨부(첨부 R2 는 deferredToWave2)·반영 토글·대상 학생 수(useRoster count). "N명에게 발송" → usePublishNotice. 존댓말.',
      '- src/screens/teacher/TeacherTimetable.tsx (+.css) — 반 시간표(T-02). useTeacherClasses/useRoster 로 렌더. 셀 편집·주 복사는 대응 엔드포인트가 useTeacher 에 있으면 배선, 없으면 deferredToWave2 로 정직 처리(읽기 표시는 하기).',
      '### 수정',
      '- src/screens/teacher/TeacherHome.tsx — (1) "오늘 알림장 작성/보내기" → navigate("/teacher/notice"). (2) 학생 초대 타일 → useRequestPairing 실호출(전화번호 입력 or 안내). (3) "반 캘린더" 타일 → navigate("/teacher/timetable").',
      '- src/screens/teacher/TeacherStudents.tsx — (1) 학생별 출/지/결 토글 컨트롤 추가 → useSetAttendance 실저장(useAttendance 로 현재상태 읽기). (2) 학생 초대(+) → useRequestPairing.',
      '### 훅: useTeacherMe, useTeacherClasses, useRoster, useAttendance, usePublishNotice, useSetAttendance, useRequestPairing.',
    ].join('\n'),
  },
  {
    name: 'notify-chat-sticker',
    prompt: [
      '## 담당: 알림센터(P-21)·채팅(P-25)·스티커주기(P-26) 실배선',
      '### 수정',
      '- src/screens/feature/Notifications.tsx (+.css) — (1) 유형별 필터 칩 추가(전체/안전/위치/일정/대화 등). (2) "모두 읽음" 버튼(useMarkAlertRead 반복 or 일괄). (3) 항목 탭 → 유형별 이동: 도착→navigate("/arrival-alerts") · 위험→navigate("/danger-alert") · 위치→/parent/location · 기타 적절히(해당 화면은 Wave2; 경로만). 스와이프 삭제 엔드포인트 없으면 deferredToWave2.',
      '- src/screens/shared/MemoChat.tsx (+.css) — (1) 대화 상대 이름/아바타 하드코딩("지우"/rabbit) → useMyFamily 실 자녀 신원. (2) 메시지 열람 시 useMarkRead 로 읽음 처리(읽음 표시 UI). (3) 사진/위치 공유 버튼: R2/위치 실전송은 deferredToWave2 로 정직 처리(무엇이 준비중인지 명시).',
      '- src/screens/feature/StickerSend.tsx (+.css) — (1) 메시지 입력 필드 추가. (2) 아이 선택 UI(다자녀 시). (3) 보내기 → useSendSticker(메시지 포함). 첫 자녀 자동고정 제거.',
      '### 훅: useParentAlerts, useMarkAlertRead, useMemoThread, useSendMemo, useMarkRead, useMyFamily, useSendSticker, useStickerSummary, useReceivedStickers.',
    ].join('\n'),
  },
]

phase('Build')

const results = await parallel(TASKS.map((t) => () =>
  agent(COMMON + '\n' + t.prompt, {
    label: 'build:' + t.name,
    phase: 'Build',
    schema: SCHEMA,
    agentType: 'general-purpose',
  })
))

const merged = { created: [], edited: [], deadButtonsFixed: [], deferredToWave2: [], notes: [] }
TASKS.forEach((t, i) => {
  const r = results[i]
  if (!r) { merged.notes.push(t.name + ': (에이전트 결과 없음)'); return }
  merged.created.push(...(r.created || []))
  merged.edited.push(...(r.edited || []))
  merged.deadButtonsFixed.push(...(r.deadButtonsFixed || []))
  merged.deferredToWave2.push(...(r.deferredToWave2 || []))
  if (r.notes) merged.notes.push(t.name + ': ' + r.notes)
})
return merged
