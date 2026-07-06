export const meta = {
  name: 'wf-tier-photo-color',
  description: '구독 티어 게이팅 + 아이 사진 등록 + 색상 설정 제거(3 에이전트)',
  phases: [{ title: 'Build', detail: '티어/사진/색상 병렬' }],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['created', 'edited', 'summary', 'notes'],
  properties: {
    created: { type: 'array', items: { type: 'string' } },
    edited: { type: 'array', items: { type: 'string' } },
    summary: { type: 'array', items: { type: 'string' }, description: '한 것 요약(핵심 변경)' },
    notes: { type: 'string', description: '통합 담당자 주의점(라우트/삭제 대상 등)' },
  },
}

const H1 = 'C:/Users/TK/Desktop/hyeni-1'

const POLICY = [
  '## 확정 구독 티어 정책(단일 소스: src/transform/tierPolicy.ts — 이미 존재, import 해서 사용. 수정 금지)',
  '- 아이 등록: 무료 1명 / 리뷰 1명 / 프리미엄 2명. (maxChildrenFor, canAddChild)',
  '- 위치: 무료=잠금 / 리뷰=지연 / 프리미엄=실시간. (locationModeFor→"locked"|"delayed"|"realtime", isLocationVisible, isRealtimeLocation)',
  '- 일정/장소: 1 / 3 / 무제한. (scheduleLimitFor, placeLimitFor)',
  '- 프리미엄 전용: 실시간위치·주변소리·AI하루요약·학원시간표·다중위험구역·이동경로연장·다자녀. (canUse(tier, FEATURES.X))',
  '- 안전(SOS·위험구역 안전알림)은 티어 무관 항상 동작.',
  '- 가격: 프리미엄 월 2,900원(아이별 구독). 리뷰=앱 리뷰 보상.',
  '- 티어 판정: tierFrom({ ready, isPremium, reviewed }) → "unknown"|"free"|"reviewed"|"premium". ready=false면 unknown(게이트/강등 금지 — R9).',
  '- getTierLabel, lockMessageFor 제공.',
].join('\n')

const COMMON = [
  '너는 혜니캘린더(React19+TS strict+Vite+플레인CSS토큰+HashRouter+TanStack Query+lucide-react) 엔지니어다. 백엔드는 실재(hyeni-1 Worker).',
  '작업 전 Read: docs/WIREFRAME-BUILD-CONTRACT.md, src/transform/tierPolicy.ts, src/lib/api/client.ts, 그리고 네가 수정할 파일 + 필요한 queries/endpoints.',
  '',
  POLICY,
  '',
  '## 규칙',
  '- **지정된 파일만** 생성/수정. App.tsx(라우트)는 통합 담당자가 함 — navigate("경로",{state})만.',
  '- 컴포넌트는 queries 훅만 사용(endpoints 직접호출 금지). 새 endpoint 필요하면 지정된 endpoints 파일에 추가하고 queries 훅으로 감싼다.',
  '- strict TS(import type·미사용0·button type=button·인라인 --커스텀 금지), 화면별 전용 css/고유 프리픽스, safe-area, dateKey는 @/transform/dateKey.',
  '- 정직 원칙: 서버 없는 액션은 disabled+사유. 빌드는 실행하지 마라(통합 일괄).',
  '',
].join('\n')

const TASKS = [
  {
    name: 'tier-gating',
    prompt: [
      '## 담당: 구독 티어 게이팅(확실하게 나누기)',
      '### 소유 파일: src/queries/useEntitlement.ts, src/transform/entitlement.ts, src/lib/api/endpoints/subscription.ts, (신규)src/lib/api/endpoints/reviewReward.ts, (신규)src/queries/useReviewReward.ts, src/screens/feature/Subscription.tsx(+css), src/screens/feature/TrialLock.tsx(+css), src/screens/parent/ParentFamily.tsx(+css), src/screens/parent/ParentLocation.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/review-rewards.ts, ' + H1 + '/src/lib/tierPolicy.js, ' + H1 + '/src/lib/effectiveLocation.js, ' + H1 + '/src/components/parent/FamilyScreen.jsx(maxChildren), ' + H1 + '/src/lib/paywallCopy.js',
      '### 할 일',
      '1) **리뷰 티어 포팅**: reviewReward.ts = GET /api/review-rewards?familyId= → { rewarded:boolean }. useReviewReward 훅. entitlement 파생에 reviewed 반영해 useEntitlement 가 tier 를 노출하도록 확장(tier = tierFrom({ready, isPremium, reviewed})). useEntitlement 결과에 tier·reviewed 추가(기존 ready/isPremium/view 유지).',
      '2) **아이 추가 게이트(ParentFamily)**: 현재 아이 수 >= maxChildrenFor(tier) 면 "아이 추가하기"를 잠금 처리 — lockMessageFor(FEATURES.MULTI_CHILD) 안내 + /subscription 으로 유도(pairing-wizard 로 안 감). 여유 있으면 정상 진입. ready=false면 잠금 UI 금지.',
      '3) **위치 게이트(ParentLocation)**: locationModeFor(tier) 적용 — "locked"(무료): 지도/마커를 흐리게+잠금 오버레이("실시간 위치는 프리미엄" + /subscription CTA), 단 SOS/위험구역 안전 액션은 유지. "delayed"(리뷰): 위치 표시하되 "약 N분 지연" 배지 + 실시간 새로고침 비활성(effectiveLocation 개념). "realtime"(프리미엄): 기존대로. ready=false면 잠금 표시 금지(로딩).',
      '4) **플랜 비교표(Subscription S-02)**: 무료/리뷰/프리미엄 3열 비교표 — 아이수(1/1/2)·위치(잠금/지연/실시간)·일정(1/3/무제한)·장소(1/3/무제한)·주변소리·AI하루요약·SOS(전부✓). 월 2,900원 명시. 현재 tier 하이라이트.',
      '5) **TrialLock**: tier/ready 로 잠금 상태 정리.',
    ].join('\n'),
  },
  {
    name: 'child-photo',
    prompt: [
      '## 담당: 아이 사진·이름 등록 + 히어로 사진 표시 (+ 이 파일들의 색상 제거·아이수 캡)',
      '### 소유 파일: src/lib/api/endpoints/family.ts, src/queries/useFamily.ts, (신규)src/lib/api/endpoints/childPhoto.ts, (신규 유틸)src/lib/imageResize.ts, src/screens/feature/ProfileEdit.tsx(+css), src/screens/feature/PairingWizard.tsx(+css), src/screens/child/ChildHome.tsx(+css)',
      '### hyeni-1 참조: ' + H1 + '/worker/routes/storage.ts(PUT/POST /api/storage/child-photos/:path), ' + H1 + '/worker/routes/family.ts(POST /member/photo = set_family_member_photo_url_by_id, {family_id,id,photo_url}), ' + H1 + '/src/lib/imageResize.js, ' + H1 + '/src/components/multichild/PairingWizard/PairingWizard.jsx',
      '### 할 일 (Task2 사진)',
      '1) imageResize.ts: resizeImageFileSafe(file,{maxEdge:1280,quality:0.8})→dataURL(캔버스, 실패시 원본 dataURL 폴백), dataUrl→Blob 헬퍼. (hyeni-1 직역)',
      '2) childPhoto.ts: uploadChildPhoto(familyId, memberId, dataUrl) — 이미지 바이트를 PUT /api/storage/child-photos/{familyId}/{memberId}-{stamp}.jpg (raw binary, Content-Type image/jpeg, Bearer) 업로드 → 그 저장 경로를 photo_url 로 POST /api/family/member/photo {family_id, id:memberId, photo_url}. 반환=photo_url. (family.ts 의 enrichPhotos 가 표시용 proxy URL 로 이미 변환하므로 저장은 raw 경로로.)',
      '   ※ stamp 는 인자로 받거나 index 로(Date.now 금지 — 워크플로 제약 아님, 컴포넌트에선 사용 가능하나 유틸은 인자로 받게).',
      '3) useFamily 에 useUploadChildPhoto 뮤테이션 추가(성공 시 가족 캐시 무효화).',
      '4) ProfileEdit: 아이 프로필 편집 = **사진 등록(파일 선택→미리보기)** + 이름. 저장 → uploadChildPhoto + setChildProfile(이름). 기존 동물 아바타 선택·목업 하드코딩 제거. 어느 아이인지 = location.state.childId(없으면 첫 자녀).',
      '5) ChildHome 히어로: 현재 캐릭터(animal/rabbit.webp) 자리에 **본인 사진** 표시 — useMyFamily 에서 user_id===useAuth().userId 인 멤버의 photo_url. 있으면 사진(원형), 없으면 기존 캐릭터 폴백.',
      '### 할 일 (Task3 색상 제거 — 이 파일들 한정)',
      '6) ProfileEdit·PairingWizard·ChildHome 에서 **색상 선택 UI 전부 제거**. setChildProfile 은 color 를 선택식이 아니라 내부 자동배정으로 — endpoints/family.ts 의 setChildProfile 을 color 옵션화(미지정 시 child_order/index 기반 기본 팔레트 색 자동 부여)하여 서버 계약(color_hex 필수) 충족. PairingWizard 는 색상 단계 제거(이름+사진만), 아이 수 단계는 유지하되 maxChildrenFor(tier) 로 상한(초과 선택 불가).',
      '### 할 일 (Task1 아이수 캡)',
      '7) PairingWizard 아이 수 선택 상한 = maxChildrenFor(tierFrom({ready, isPremium})) (useEntitlement). 초과는 "프리미엄에서 2명" 안내.',
    ].join('\n'),
  },
  {
    name: 'color-removal',
    prompt: [
      '## 담당: 색상/테마 설정 제거(부모·아이 모드 전반)',
      '### 소유 파일: src/screens/feature/ThemeSettings.tsx(+css), src/screens/child/ChildSettings.tsx(+css), src/screens/parent/ParentSettings.tsx(+css), src/app/accent.tsx',
      '### 할 일',
      '- **ParentSettings**: "테마·색상"(theme-settings) 진입 행 제거. 설정 목록에서 색상 관련 항목 삭제.',
      '- **ThemeSettings(P-33)**: 색상 선택·아이별 색 지정·라이트/다크 색 프리셋 UI 전부 제거. 화면이 비면 크래시 없게 "테마는 기본값으로 고정돼 있어요" 한 줄 안내 화면으로 축소(라우트는 통합 담당자가 정리; 너는 컴포넌트만 축소). export 이름(ThemeSettings) 유지.',
      '- **ChildSettings(K-10)**: 아이 설정에서 색상/테마 선택 섹션 제거(나머지 프로필·연결·알림 항목은 유지).',
      '- **accent.tsx(AccentProvider/useAccent)**: 런타임 액센트 프로바이더는 유지하되 **기본값 고정**(rose). 사용자/아이 색상 선택으로 accent 를 바꾸는 경로가 있으면 제거하고 고정 기본만 주입. (--hy-accent* 토큰은 그대로 두되 선택 UI 없음.)',
      '- 다른 화면(ChildHome의 "내 색깔 고르기")은 child-photo 담당이 처리하므로 건드리지 마라.',
      '- 색상 제거로 미사용된 import/변수 0 으로 정리(strict).',
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
