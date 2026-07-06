export const meta = {
  name: 'wf-childinfo-location',
  description: '아이 정보 전체 편집(실시간) + 길찾기 도보 논리 + 오늘 이동경로 + 위치수집 hyeni-1 정렬',
  phases: [{ title: 'Build', detail: '아이정보 / 위치 병렬' }],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['created', 'edited', 'summary', 'notes'],
  properties: {
    created: { type: 'array', items: { type: 'string' } },
    edited: { type: 'array', items: { type: 'string' } },
    summary: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const H1 = 'C:/Users/TK/Desktop/hyeni-1'
const COMMON = [
  '너는 혜니캘린더(React19+TS strict+Vite+HashRouter+TanStack Query+플레인CSS토큰+lucide-react) 엔지니어. 백엔드=hyeni-1 Cloudflare Worker(실재, 방금 아이 프로필 확장 배포됨).',
  '작업 전 Read: docs/WIREFRAME-BUILD-CONTRACT.md, src/lib/api/client.ts, 수정할 파일, 지정 hyeni-1 참조.',
  '규칙: 지정 파일만 수정. App.tsx 라우트는 통합 담당자. strict TS(import type·미사용0·button type=button·인라인 --커스텀 금지). safe-area. dateKey는 @/transform/dateKey. queries 훅만 사용. 정직 처리(가짜 데이터 금지). 빌드 실행 금지(통합 일괄).',
  '',
].join('\n')

const TASKS = [
  {
    name: 'child-info-edit',
    prompt: [
      '## 담당: 부모가 아이 전 정보 편집(이름·사진·생일·전화) → 아이기기 실시간 반영',
      '### 소유 파일: src/lib/api/endpoints/family.ts, src/queries/useFamily.ts, src/screens/feature/ProfileEdit.tsx(+css)',
      '### 백엔드(방금 배포됨): POST /api/family/member/profile 는 이제 { family_id, member_id, new_name(필수), color_hex?(선택), birthdate?("YYYY-MM-DD"|null), phone?(문자열|null) } 을 부분수정한다(키가 있을 때만). notifyPg 로 가족 WS 실시간 반영됨. 사진은 기존 uploadChildPhoto(childPhoto.ts). FamilyMember 에 birthdate/phone 이 이미 있음(family.ts SELECT 확인).',
      '### 할 일',
      '1) endpoints/family.ts: setChildProfile 를 확장 — 시그니처에 optional birthdate?/phone? 추가, POST body 에 birthdate/phone 을 (제공 시) 포함. 기존 name/color 유지. (member/profile 실계약 필드명: new_name, color_hex, birthdate, phone.)',
      '2) useFamily.ts: useSetChildProfile 이 birthdate/phone 도 전달하도록.',
      '3) ProfileEdit.tsx: 아이 정보 편집 폼 = 사진(기존 파일선택) + 이름 + **생일(input type=date)** + **전화번호(input inputMode=tel, 010-0000-0000 포맷)** + (선택)나이 자동표시(생일로 계산). 대상 아이 = location.state.childId(없으면 첫 자녀). 현재값을 해당 child member(name/birthdate/phone/photo_url)에서 프리필. 저장 → uploadChildPhoto(사진 변경 시) + setChildProfile(name/birthdate/phone). 주 보호자(family.isPrimaryParent)만 편집 가능(아니면 disabled+안내). 저장 성공 후 "아이 기기에 실시간으로 반영돼요" 안내. 기존 하드코딩(지우/학년 상수) 잔재 제거.',
      '4) 전화번호 정규화는 @/transform/phone 의 헬퍼 재사용 가능하면 사용(숫자만/포맷).',
      '### 검증 관점: 부모가 편집 저장 → 서버 UPDATE → 가족 WS → 아이 기기 useMyFamily 자동 갱신(실시간). 코드가 이 경로를 깨지 않게.',
    ].join('\n'),
  },
  {
    name: 'walking-trail-parity',
    prompt: [
      '## 담당: 길찾기 도보 논리 + 오늘 이동경로(프리미엄) + 위치수집 hyeni-1 정렬',
      '### 소유 파일: src/screens/feature/RouteView.tsx(+css), src/screens/parent/ParentLocation.tsx(+css), src/queries/useLocation.ts, src/queries/useRoute.ts, src/lib/api/endpoints/location.ts, src/lib/native/location.ts',
      '### hyeni-1 참조: ' + H1 + '/src/lib/walkingRoute.js, ' + H1 + '/src/lib/routeParsers.js, ' + H1 + '/src/lib/locationTrailDisplay.js, ' + H1 + '/src/lib/trailMath.js, ' + H1 + '/src/lib/nativeLocationService.js, ' + H1 + '/src/lib/locationConstants.js, ' + H1 + '/src/lib/effectiveLocation.js, ' + H1 + '/worker/routes/location.ts(history)',
      '### 할 일',
      '1) **길찾기 도보 논리(RouteView)**: 도착지(destination)는 **다음 일정의 장소만** 사용한다. 다음 일정이 없거나 장소가 없으면 → 저장장소(학교 등)로 직선 폴백 금지, 대신 **정직한 빈 상태**("오늘 남은 일정이 없어 안내할 곳이 없어요" + 홈으로) 표시. pickDestination 을 next-event-only 로 고치고 없으면 null 반환.',
      '2) **반드시 도보**: useWalkingRoute(/api/kakao/walking-directions) 결과가 있으면 그 폴리라인만 그린다. 실패/빈 결과면 **직선(straight) 그리지 말 것** — "도보 경로를 불러오는 중…"(로딩) 또는 "도보 경로를 찾지 못했어요 · 다시 시도"(재시도 버튼) 로 대체. isApprox 직선 근사 경로 제거. (거리/시간 표기도 직선 근사면 감춤.)',
      '3) **오늘 이동경로(부모, 프리미엄)**: ParentLocation 에 "오늘 이동경로" 보기 추가 — @/transform/tierPolicy 로 프리미엄 게이트(무료/리뷰는 잠금 안내). useLocationHistory(오늘 0시~현재 ISO)로 위치 이력을 받아 KakaoMap(@/components/KakaoMap)에 **이동 경로 폴리라인 + 출발/현재 마커**를 깔끔하게 표시(hyeni-1 locationTrailDisplay/trailMath 규칙 참조: 과도한 점 다운샘플·체류 표시). 토글로 실시간위치↔오늘경로 전환. 데이터 없으면 "오늘 이동 기록이 아직 없어요".',
      '4) **위치수집 hyeni-1 정렬(lib/native/location.ts)**: startLocationTracking 이 넘기는 옵션(주기·정확도·거리필터 등)을 hyeni-1 nativeLocationService.js/locationConstants.js 값과 동일하게 맞춘다. requestImmediateLocation 등 hyeni-1 계약과 파라미터명 일치 확인(LocationPlugin.java 계약 유지).',
      '### 주의: KakaoMap 컴포넌트 API 는 기존 ParentLocation/RouteView 사용법을 Read 해 그대로. 폴리라인 그리기는 컴포넌트가 지원하는 방식으로(없으면 지도 인스턴스에 kakao.maps.Polyline 직접). 빌드 금지.',
    ].join('\n'),
  },
]

phase('Build')
const results = await parallel(TASKS.map((t) => () =>
  agent(COMMON + '\n' + t.prompt, { label: 'build:' + t.name, phase: 'Build', schema: SCHEMA, agentType: 'general-purpose' })
))
const merged = { created: [], edited: [], summary: [], notes: [] }
TASKS.forEach((t, i) => {
  const r = results[i]
  if (!r) { merged.notes.push(t.name + ': (결과 없음)'); return }
  merged.created.push(...(r.created || []))
  merged.edited.push(...(r.edited || []))
  merged.summary.push(...(r.summary || []).map((s) => t.name + ': ' + s))
  if (r.notes) merged.notes.push(t.name + ': ' + r.notes)
})
return merged
