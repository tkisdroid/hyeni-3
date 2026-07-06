export const meta = {
  name: 'wf-error-fix',
  description: '감사 발견 MED/LOW 결함 수정(5 에이전트, 파일 disjoint)',
  phases: [{ title: 'Fix', detail: '5개 영역 병렬 수정' }],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['edited', 'summary', 'notes'],
  properties: {
    edited: { type: 'array', items: { type: 'string' } },
    summary: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const COMMON = [
  '너는 혜니캘린더(React19+TS strict+Vite+HashRouter+TanStack Query, 백엔드=Cloudflare Worker) 엔지니어. 감사에서 확정된 결함을 **정확히** 수정한다.',
  '작업 전 해당 파일과 관련 훅/유틸을 Read 로 열어 실제 코드를 확인하고, 지정된 fix 를 최소 변경으로 적용한다. 다른 파일·다른 로직은 건드리지 말 것.',
  'strict TS(import type·미사용0·button type=button·인라인 --커스텀 금지), 불변성(spread), dateKey는 @/transform/dateKey. 빌드는 실행하지 마라(통합 일괄).',
  '',
].join('\n')

const TASKS = [
  {
    name: 'auth-fix',
    prompt: [
      '## 소유 파일: src/screens/onboarding/Onboarding.tsx, src/lib/api/client.ts, src/queries/useEntitlement.ts',
      '### 수정 1 (Onboarding 부모 이름 깨짐)',
      'SignupStep(전화 OTP 가입) 완료 후 syncFromSession 이 안 돼 useAuth().user 가 null → ConnectStep "새 가족 만들기"가 setupFamily({parentName: parentNameFromUser(null)})="부모"(깨진 기본값)로 저장한다. 수정: 가입 시 입력한 이름이 setupFamily 에 반영되게 하라. 가장 안전한 방법 — SignupStep 이 가입 성공 시 입력한 name 을 상위로 전달하고(onDone(name) 등) Onboarding 이 그 이름을 상태로 보관, ConnectStep onNewFamily 의 setupFamily({parentName: 그 이름 || parentNameFromUser(user)}) 로 쓴다. (또는 verify 직후 syncFromSession() 호출로 user 를 채우는 방법도 가능하나, 서버가 세션 user_metadata.name 을 즉시 주지 않을 수 있으니 입력 이름 전달이 더 확실.)',
      '### 수정 2 (세션 만료 복구 불가)',
      'client.ts apiRequest: 401 → refreshAccess() 재시도가 실패(false)하거나 재시도 후에도 401 이면 **세션을 clear** 해야 한다(clearApiSession 또는 setApiTokens(null) → notifyTokens 로 AuthProvider 재동기화). 안 그러면 만료 사용자가 status=authenticated 로 남아 401 도배 홈에 갇힌다. session.ts 의 clear API 를 Read 해 정확히 호출. (refresh 실패 시에만 clear; 정상 401-후-성공은 clear 금지.)',
      '### 수정 3 (티어 unknown 고정)',
      'useEntitlement: review-rewards 조회가 영구 실패하면 비프리미엄 tier 가 unknown 으로 고정돼 free/reviewed 게이트가 앱 전역에서 확정 안 됨. 수정: review-rewards 는 서버가 대부분 graceful(rewarded=false)이므로, useReviewReward 의 isError(또는 미준비)를 reviewed=false 로 안전 처리해 엔타이틀먼트가 ready 면 tier 를 free/premium 으로 확정하게 하라(엔타이틀먼트 자체가 ready 인 한 unknown 에 머물지 않게). R9(프리미엄 강등 금지)는 유지 — 엔타이틀먼트 ready=false 일 때만 unknown.',
    ].join('\n'),
  },
  {
    name: 'family-child-fix',
    prompt: [
      '## 소유 파일: src/screens/feature/ChildInvite.tsx, src/screens/child/ChildHome.tsx, src/screens/parent/ParentHome.tsx',
      '### 수정 1 (ChildInvite 연결 감지 안 됨)',
      '아이 연결 감지를 전체 자녀 수 증가로 판정하는데, placeholder 흐름은 아이가 placeholder 행 user_id 만 채워 수가 안 늘어 감지가 영영 안 된다. 수정: baseline/현재값을 **연결된 자녀 수**(role==="child" && m.user_id 존재)로 계산하도록 바꿔라. 그 수가 baseline 보다 커지면 연결로 판정(기존 토스트+navigate 유지).',
      '### 수정 2 (ChildHome 준비물 형제 것까지 표시/수정)',
      'ChildHome 은 daily-supplies 를 본인으로 필터하지 않아 형제 항목이 섞여 남의 데이터를 건드린다. 수정: 본인 member(myMember)로 필터 — supplies 를 suppliesQuery.data 그대로 쓰지 말고 본인 것만: child_user_id 가 myMember 를 가리키는 항목만(서버가 child_user_id 에 무엇을 넣는지 Supplies.tsx 의 targetChildId 필터 방식을 Read 해 동일 기준 적용; 보통 member.id 또는 user_id). 렌더·prepDone·카운트 모두 필터된 배열 사용.',
      '### 수정 3 (ParentHome 준비물 아이별 미필터)',
      'ParentHome 도 동일하게 대표 아이(childMember.id/user_id, ChildHome 과 동일 기준)로 daily-supplies 를 필터해 표시·카운트하라. (다자녀 시 뭉치는 문제 완화.)',
      '두 화면의 필터 기준(child_user_id 매칭 값)은 Supplies.tsx 와 일치시켜라.',
    ].join('\n'),
  },
  {
    name: 'safety-fix',
    prompt: [
      '## 소유 파일: src/screens/feature/SosReceive.tsx, src/screens/child/ChildSos.tsx',
      '### 수정 1 (SosReceive 시각 Invalid Date)',
      'SOS created_at 을 raw new Date()/Date.parse 로 파싱해 서버 pg 타임스탬프(공백구분+bare +00)가 iOS Safari 에서 Invalid Date 가 된다. 수정: latest.created_at·목록 s.created_at 을 **parseServerTimestamp**(위치 updated_at 처리에 이미 쓰는 유틸; @/transform 어딘가에 있음 — Grep 로 확인)로 감싸 정규화한 Date 를 formatClock/relativeFrom 에 넘겨라.',
      '### 수정 2 (ChildSos 완료화면 엄마 하드코딩)',
      'ChildSos sent(성공) 오버레이가 부모를 "엄마"로 하드코딩 + 유일 전화버튼이 mom 전용이라 아빠만 있는 가정에서 발신 불가. 수정: error phase 처럼 **존재하는 부모(mom/dad)만 조건부로 전화 버튼 렌더**하고, 제목/문구를 실제 연결된 부모 기준으로 파생(가족 members 에서 parent gender 로 라벨). callMom 하드코딩 제거하고 실제 있는 부모 번호로 발신.',
    ].join('\n'),
  },
  {
    name: 'realtime-settings-fix',
    prompt: [
      '## 소유 파일: src/queries/useFamilyRealtime.ts, src/screens/feature/NotificationSettings.tsx',
      '### 수정 1 (스티커 실시간 미반영)',
      'useFamilyRealtime 의 keysForMessage switch 에 "stickers" case 가 없어 스티커 INSERT WS 수신 시 캐시 무효화가 안 된다. 수정: switch 에 case "stickers": 를 추가해 스티커 관련 쿼리키를 반환(예: qk.stickerSummary(familyId) 와 받은스티커 키). qk 팩토리(keys.ts)와 useStickers.ts 의 실제 queryKey 를 Read 해 정확한 키를 반환하라(존재하는 키만).',
      '### 수정 2 (알림설정 기본값 덮어쓰기)',
      'NotificationSettings hydrate useEffect 가 조회 실패(isError, data 없음)에도 draft=DEFAULT 로 seed 하고 hydrated=true 로 잠근 뒤, 재시도 성공해도 재-seed 안 해 서버 실값 대신 DEFAULT 가 남고 토글 시 서버 설정을 DEFAULT 로 덮어쓴다. 수정: hydrate 게이트를 **데이터 도착 기준**으로 — 성공 data(서버값 또는 null 확정)가 실제 도착했을 때만 1회 seed 하도록. (예: data===undefined 면 return; 로 미도착 시 seed 안 함. isError 상태에선 seed 하지 말고 로딩/재시도 UI 유지.)',
    ].join('\n'),
  },
  {
    name: 'location-fix',
    prompt: [
      '## 소유 파일: src/screens/feature/PlaceForm.tsx, src/screens/parent/ParentLocation.tsx',
      '### 수정 1 (PlaceForm 위험 선택 무시 → 오인)',
      'PlaceForm 종류에서 "위험" 선택이 무시되고 일반 saved-place 로 저장돼 위험 지오펜스/알림이 안 생긴다(사용자는 위험구역 등록했다고 오인). saved-place API 에 위험 카테고리가 없으므로, 수정: PlaceForm 의 종류 옵션에서 **"위험" 칩을 제거**하고(오인 방지), 필요 시 "위험 구역은 지도의 위험구역 추가에서 등록해요" 안내를 두라. (위험구역은 DangerZoneForm 경로가 담당.)',
      '### 수정 2 (ParentLocation NaN 마커)',
      'mapPlaces 필터가 lat 만 검증하고 lng 를 안 봐서 lng 없는 장소가 NaN 좌표 마커가 된다. 수정: filter 조건에 typeof p.location?.lng === "number" 를 추가해 lat·lng 모두 유효할 때만 마커 생성(nearestPlace 검증과 대칭).',
    ].join('\n'),
  },
]

phase('Fix')
const results = await parallel(TASKS.map((t) => () =>
  agent(COMMON + '\n' + t.prompt, { label: 'fix:' + t.name, phase: 'Fix', schema: SCHEMA, agentType: 'general-purpose' })
))
const merged = { edited: [], summary: [], notes: [] }
TASKS.forEach((t, i) => {
  const r = results[i]
  if (!r) { merged.notes.push(t.name + ': (결과 없음)'); return }
  merged.edited.push(...(r.edited || []))
  merged.summary.push(...(r.summary || []).map((s) => t.name + ': ' + s))
  if (r.notes) merged.notes.push(t.name + ': ' + r.notes)
})
return merged
