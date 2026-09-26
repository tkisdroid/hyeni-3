# 화면·디자인 구현 참고

이 문서는 2026-09-12에 자동 지침에서 분리한 작업별 참고 자료입니다. 관련 항목만 찾아 읽으세요.
날짜가 붙은 배포·기기·자격 상태는 당시 관측이며, 현재 상태는 해당 작업에서 확인합니다.
작업 범위와 승인·완료 기준은 루트 `AGENTS.md`와 현재 사용자 요청을 따릅니다.

## 코딩 컨벤션

- hex 직접 금지 → `src/styles/tokens.css` CSS 변수. 신호색 고정(민트=안전, 앰버=주의, 레드=위험/SOS, 파랑=정보).
- 공통: `.hy-card .hy-press .hy-chip .hy-topbar .hy-content` · `TopBar`/`SectionHeader` · `asset("경로")` · lucide 아이콘.
- 화면 패턴 정답 = `src/screens/parent/ParentHome.tsx`. 탭 화면=각 Shell 하위, 상세=PushShell(뒤로가기 `navigate(-1)`).
- strict TS: `import type`, 미사용 금지, `<button type="button">`, 상태는 불변 업데이트(spread).
- LLM 호출·크레딧 소모·원격 제어(force_ring 등)는 **사용자 버튼 onClick 에서만**(자동 실행 금지).
- 아이 홈처럼 티커/스파클/SOS hold 등 움직임이 있는 화면은 `prefers-reduced-motion`에서 애니메이션·전환을 멈춘다.
  ChildHome JSX의 주요 색상은 직접 hex 대신 토큰 변수를 사용하며, `tests/mobileViewportCss.test.mjs`가 회귀를 막는다.

## 디자인 규칙 (2026-07-10)

- ★**장식성 마이크로 배지 금지(2026-08-14)**: 주변 제목·설명을 반복하거나 클릭되지 않는데 작은 버튼처럼 보이는
  pill/eyebrow는 렌더하지 않는다. 배지는 실제 상태·읽지 않은 수·현재 선택·티어·날짜처럼 사용자가 판단에 쓰는 정보에만
  허용한다. 온보딩 상단 `함께 보는 우리 가족` 배지, AI 친구의 가짜 온라인 점·`이야기할 준비됐어!`, 설정 버전 뒤
  장식 슬로건은 재도입하지 않는다. 가드=`scripts/final-browser-qa.mjs`의 `antiSlop` 집중 검증.
- ★**색상 대비 3단 체계(2026-07-30 검수)**: 파스텔 팔레트 위 **흰 글자는 어떤 테마색에서도 AA 를 만족할 수 없다**
  (`--hy-accent` 1.4~2.8:1 · `--hy-accent-deep` 3.34:1). WCAG 큰 글씨 완화(3:1)는 굵은 글씨라도 **18.66px 이상**에만
  적용되므로 18px/700 버튼에도 4.5:1 이 걸린다. ①주요 CTA = `--hy-accent-cta`(테마별 딥 톤) · 그라디언트는
  `--cta-grad-accent/-danger/-lavender`(두 stop 모두 통과) ②보조 버튼·선택 칩 = `--hy-accent-soft` + `--hy-accent-text`
  + 1.5px accent 테두리 ③미선택 칩 = `--bg-chip-idle` + `--fg-tertiary`. **비텍스트 면(장식·아바타·진행바·마커)은 계속
  `--hy-accent`.** 문구 토큰은 card·app·page·body **네 표면 전부** 4.5:1 이상이어야 한다. 카테고리·태그 색은
  `--cat-*-text/-soft` 토큰이 정본이며 중간 톤을 soft 위 글자색으로 쓰지 않는다. 가드=`tests/colorContrastAndRadius.test.mjs`.
- ★**어른 accent = lavender(2026-08-19)**: `ADULT_ACCENT`(childAccent.ts)로 어른 화면만 고정하고 아이 기본색
  (`DEFAULT_ACCENT`=rose)은 건드리지 않는다. ⚠️ 커스텀 속성 `var()` 는 선언된 요소에서 치환된다 —
  `--cta-grad-accent`·`--hy-accent-on-ground` 를 `:root` 에만 두면 accent 를 바꿔도 히어로가 안 바뀐다.
  `[data-accent]` 블록에서 다시 선언할 것. ⚠️ "부모가 아이 색을 안 읽는다" 가드는 정규식 거리 대신
  어른 분기의 `return` 으로 검사한다(거리로 쓰면 child 분기를 잡아 오탐).
- ★**부모 모드 시각 사양(2026-08-19)**: 바닥은 무광 오프화이트 단색(`#F2F0F4`)이고 색은 "깊은 배경"의
  하늘색·보라 블롭이 담당한다(전면 wash 금지). 뉴모피즘 면은 `--neu-surface: transparent` — 자기 배경과
  같은 색이어야 뉴모피즘이다. `--glass-lift` 첫 두 겹이 thin glowing white border 다. 알약·타일 버튼 4종은
  "조작 버튼 정본" 한 규칙을 공유하고 `:active` 로 함께 눌린다. ⚠️ 상태 배지는 버튼이 아니다(accent 칩 유지).
  ⚠️ 블롭 채도 상한은 대비가 정한다(blue 26%는 4.36:1 미달 → 15%로 4.67:1). ⚠️ CSS 일괄 치환은 의도치 않은
  선택자까지 지운다 — 치환 후 확인할 것.
- ★**섹션은 얼음 유리, 정적 오목 금지(2026-08-19)**: ⚠️ "유리 질감이 없다"의 원인이 대개 **그 카드가 애초에
  유리가 아닌 것**이다 — 재질을 바꾸기 전에 `.ph-glass` 가 실제로 붙어 있는지 확인한다(일정·안전지표 등 5개가
  불투명 `.hy-card` 였다). 얼음 = `--glass-fill` 0.42 + `blur(30px) saturate(190%)` + 또렷한 `--glass-rim`.
  콘텐츠가 뒤로 지나가는 면(탭바·입력 알약)은 `--glass-fill-solid`(0.8) 를 쓴다. 정적인 `--neu-pressed` 는 쓰지
  않고 `:active` 에만 쓴다. ⚠️ 얼음의 상한은 바닥 밝기가 정한다(실측 카드 `#EFE9F3` → `--fg-muted` 4.64:1).
  ⚠️ 대비는 픽셀 스캔이 아니라 **순수 바닥 샘플 + `over(white, fill, ground)` 계산**으로 잰다.
- ★**입체감은 그늘로, 투명도는 rim 으로(2026-08-19)**: `--neu-dark` 를 올려 입체감을 낸다(바닥을 어둡게 하면
  글자 대비가 먼저 깨진다). `--glass-fill` 을 내릴 때는 `--glass-rim` 을 같이 세운다 — 채움을 내릴수록 rim 이
  유일한 경계다. 반투명 유리는 뒤에 색이 있어야 비치므로 바닥은 "어둡게"가 아니라 "색이 많아지게" 만든다.
  ⚠️ 바닥에 색을 깔면 `--hy-accent-text` 가 먼저 깨진다(rose 3.82:1·lav 3.54:1, radial 0.20 으로 낮춰도 4.32:1) —
  바닥 전용 `--hy-accent-on-ground` 를 쓴다. ⚠️ 픽셀 스캔으로 대비를 판정하지 말 것: 3D 아이콘 색이 글자로
  잡혀 허위 경보가 난다. 토큰 쌍으로 계산한다.
- ★**뉴모피즘 + 글래스모피즘은 면의 역할로 나눈다(2026-08-19)**: 두 스타일은 바닥 요구가 정반대다 —
  유리는 색 바닥이 있어야 굴절하고, 뉴모피즘은 바닥이 솟은 면보다 어두워야 흰 하이라이트가 보인다.
  큰 면=유리(`.ph-glass`·탭바), 작은 조작 면=볼록(`--neu-raised`), 값이 들어가는 면=눌린 우물(`--neu-pressed`).
  `:active` 에서 raised→pressed 로 실제로 눌린다. ⚠️ 바닥은 `color-mix(--bg-body 74%, --bg-app)` 이 전제이고,
  이 바닥에서 `--fg-muted` 가 4.72:1 이라 **더 어둡게 하면 AA 가 깨진다** — 입체감은 `--neu-dark` 로 올린다.
  ⚠️ 뉴모피즘을 색 바닥 위에 직접 두지 않는다. ⚠️ 값이 들어가는 면은 card 가 아니라 `well` 역할이다.
- ★**부모 홈 유리 보정(2026-08-19)**: 구조(`.ph-page::before` 바닥 + `.ph-glass` 카드)는 그대로 두고 값만 고친다.
  바닥은 **색 두 가지·26% 이하**(4색 고채도가 촌스러움의 실체였다), 유리 질감은 채움이 아니라 **rim** 이 만든다
  (`.ph-glass` 는 탭바와 같은 `--glass-*` 정본을 쓴다 — 더 투명하게 내리면 질감이 사라지고 대비도 깨진다).
  바닥은 한 겹만 — 셸에도 깔면 `.ph-page::before` 와 두 겹이 된다. 카드 유리도 셸에서 `.hy-card` 를 덮지 말고
  화면이 `.ph-glass` 로 명시한다(semantic surface 계약). 히어로는 `padding-right: 128px` 로 마스코트 자리를
  비우지 않으면 문구가 마스코트를 뚫는다.
- ★**부모 홈 실데이터 유리 불변식(2026-08-20)**: 빈 상태뿐 아니라 `children.map` 의 실제 아이 카드까지 모든
  주요 `hy-card` 에 `ph-glass` 를 붙인다. `.ph-ai`·`.ph-child--active` 같은 variant가 `box-shadow` 를 선언하면
  `var(--glass-rim), var(--glass-lift)` 를 먼저 합성해 공통 유리 깊이를 지우지 않는다. 유리 카드의 semantic surface
  역할은 일반 `card` 허용 범위를 넓히지 않고 `glass-card` 로 분리한다. 회귀=`tests/parentHomeGlassMaterial.test.mjs`.
- ★**대화 전송은 낙관적(2026-08-19)**: `useSendMemo.onMutate` 로 임시 행을 넣고 화면은 mutate 직전에 입력칸을
  비운다(실측 2,000ms → 7ms). ⚠️ 임시 행은 지우고 다시 넣지 말고 `reconcilePendingMemoReply` 로 제자리 교체한다 —
  먼저 지우면 응답이 배열·빈 객체일 때 방금 보낸 말풍선이 사라진다. 실패는 임시 행을 걷고 원문을 되돌린다.
  `useMarkRead` 에 invalidateQueries 를 걸지 않는다 — 미읽음 N개가 7일치 스레드를 N번 재조회하게 만든다.
  회귀=`tests/memoSendCache.test.ts`.
- ⚠️ **작업 전 `git fetch`**(2026-08-19 실사고): 같은 화면을 원격이 이미 고쳐 둔 채로 낡은 base 에서 재디자인해
  진단과 push 가 모두 어긋났다. 겹치면 원격 구조를 기준으로 값만 보정한다(force push 금지).
- ★**하단 탭바 = 유리판(2026-08-19)**: 정본은 `components.css` 의 `.hy-tabbar`(스크림)·`.hy-tabbar__inner`(유리)
  두 블록이고 부모·선생님 셸 공용이다(아이 모드는 `ChildDock` 별도). ⚠️ **조상에 `backdrop-filter` 가 있으면
  자식 유리의 backdrop 이 그 조상으로 격리돼 뒤 화면이 안 비친다** — 블러는 알약 한 곳에만 걸고 스크림은
  페이드(0 → 0.38 → 0.72)만 맡는다. ⚠️ **유리 위 선택 상태를 채움색으로 알리지 않는다** — 뒤 화면이 같은 계열이면
  `--hy-accent-soft` 칩이 사라진다(로즈 히어로 위 실측). 색이 아니라 윤곽(안쪽 흰 테두리 1px + 얕은 그림자)으로 알린다.
  `saturate(180%)` 없으면 파스텔 위에서 유리가 회색으로 죽고, 미지원 환경은 `@supports not` 으로 `--bg-card` 강등한다.
  대비는 추정하지 말고 캡처 픽셀을 디코딩해 실측한다(최악 조건 비활성 5.08:1 · 활성 5.46:1). 이 선택자는
  `designSystemUsage` non-surface manifest와 `releaseVisualConsistencyContract` 의 `var(--radius-pill)` 기대에
  exact 등록돼 있어 **배경+radius 를 가진 새 pseudo 를 추가하면 막힌다** — 테두리·하이라이트는 같은 요소의
  `border`+`box-shadow` 로만 만든다.
- ★**모서리 반경은 8/12/16/20/24px·pill 만**(2026-07-30 · 161건 정규화). 예외는 UI 표면이 아닌 것뿐 —
  장식(색종이·블롭·히어로 orb), 폰 베젤 `.hy-app`(44px), 인라인 링크 `:focus-visible` 링(2px). 같은 가드가 강제한다.
- UI 요소 아이콘은 유니코드 이모지 대신 **3D 에셋(public/assets)** 또는 lucide 라인 아이콘. 색 칩 위에는 알파 채널 있는 에셋만
  (`status/*.webp`는 흰 배경 불투명 — 사용 금지 목록. `ui/mic-lavender.webp`는 2026-07-14 투명본으로 교체돼 사용 가능).
  일정 아이콘은 `resolveEventCharacter`(제목→cat/*.webp).
- ★부모 설정 아이콘은 clay 3D 세트 하나다(2026-08-18 TK 지시): 설정 화면의 모든 행이 `public/assets/ui/clay/*.webp`
  25종을 쓰고(`scripts/import-clay-3d-icons.mjs` 가 표를 들고 있다), lucide 는 chevron·뒤로가기·삭제 모달에만 남는다.
  칩 38px·그림 32px. 브라우저 QA 가 `parent-settings-icons(.bottom).png` 두 장을 남긴다.
- ★아이콘 언어 통일(2026-07-14): 기능 타일·색 칩·히어로·안전지표 = 3D webp(menu-*/place-* 기준), 텍스트 행 인라인·유틸 =
  lucide. 진한 선 스타일 플랫 SVG(`ui/icon-*.svg`) 재유입 금지. 안전지표 4칸 = battery/clock-3d/lock-open-3d/wifi-3d.webp,
  프리미엄 잠금 = lock-3d.webp, 주간리포트 히어로 = chart-3d.webp. 새 3D 아이콘은 원본 팩 `assets/05-icons/*` 변환 우선,
  없으면 클레이 스타일 SVG→sharp 렌더(알파 투명 256px). 화면 내 형제 요소와의 일관성이 우선(설정/알림 색 칩 lucide+data-tone
  유지). 가드=`tests/iconConsistency.test.mjs`.
- 리포트류 화면(안심/주간)은 구독 화면과 같은 3D 타일 언어를 유지한다. `loggingBehavior:"none"` 유지(토큰 로그 차단 — "production"은 반대 의미).
- ★공용 컴포넌트에 인라인 `style` 로 배치(position/inset/size)를 주지 않는다. `KakaoMap` 래퍼의 인라인 `position:relative` 가
  `.pl-map{position:absolute;inset:0}` 을 덮어써 **부모모드 지도가 통째로 사라진 사고**(2026-07-10)가 있었다. 배치는 소비 화면
  클래스의 몫, 컴포넌트는 `.km-host`/`.km-canvas` 같은 클래스만 쓴다. 가드=`tests/mapPerf.test.ts`.
- 장식(구름·블롭)은 제목/노드 밴드를 침범하지 않는다. 반투명은 `background: rgba(...)` 대신 `background:#fff`+`opacity`
  (겹친 덩이의 이음선 방지). 가드=`tests/mobileViewportCss.test.mjs`.
- 조용한 에러 금지 안전망 3겹: ①ErrorBoundary(`app/ErrorBoundary.tsx`, 전 라우트 errorElement, DEV `#/crash-test`)
  ②전역 uncaught/rejection→폴백 토스트(`app/GlobalErrorListeners.tsx`) ③mutation 폴백(QueryProvider MutationCache,
  450ms 지연-양보, `meta:{silentError:true}` 옵트아웃). 가드=`tests/globalErrorSafety.test.mjs`.
- 모든 인터랙티브 요소에 프레스 피드백: 버튼/카드=`hy-press`, 행/라벨=`:active{background:var(--bg-press)}`.
  스크림/딤은 예외.
- ★타입·여백·아이콘 정본(2026-07-19): 글자는 `--type-*`의 12/13/14/15/16/18/20/24/32px 의미 단계와
  대응 line-height·weight를 한 묶음으로 사용한다. 여백은 4px 리듬(`--spacing-*`), 아이콘 glyph는
  16/18/20/22/24px(`--icon-*`)로 제한하고 터치 영역과 분리한다. 모든 조작 영역은 최소 44px, 주요 저장·확인·위험 CTA는
  48px 이상을 유지한다. lucide 형제 아이콘은 같은 크기·strokeWidth를 사용하며 의미 전달용 유니코드 이모지는 금지한다.
- ★표면 정본(2026-07-19): radius는 8/12/16/20/24px·pill만, elevation은 `--shadow-soft/floating/modal`만 사용한다.
  임의 radius·shadow를 새로 만들지 않고 같은 계층의 카드·시트·모달은 같은 토큰을 쓴다.
- ★운영자 전역 AI 지침(2026-07-24): 관리자가 `#/admin/ai-prompt`(숨은 라우트)에서 저장한 지침이 **모든 가족의 아이**
  AI 대화에 들어간다. admin 역할이 없으므로 권한은 Worker secret `ADMIN_USER_IDS` 화이트리스트뿐이고 미설정이면
  아무도 관리자가 아니다(fail-closed). 화이트리스트 밖에는 404. 입력은 서버가 정규화(제어문자 제거·4000자 상한)하고,
  `## 운영자 지침`은 안전 규칙보다 앞에 배치해 마지막 발언권을 안전 규칙에 남긴다. 정책 우선순위는
  안전 > 앱 안전 > 부모 설정 > 운영자 지침 > 아이 요청. 조회 실패는 지침 없음으로 강등한다.
  라우트를 늘렸으면 routeLazyLoading·routeQualityMatrix·helpers/routeContract의 개수 정본도 함께 갱신한다.
- ★채팅 UI·포커스 링(2026-07-24): `outline:none`은 `tests/designSystemUsage`가 예외 없이 금지한다.
  입력창의 "파란 네모"는 전역 focus ring이 radius 없는 input에 각지게 그려진 것이므로 제거 대신
  `outline-color/width/offset`과 `border-radius`로 앱 톤의 둥근 링으로 바꾼다. 전역 규칙이
  `body :where(...):focus-visible`(0,1,1)이라 `.cls:focus,.cls:focus-visible`(0,2,0)로 써야 이긴다.
  신고 진입점은 메시지마다 버튼을 띄우지 않고 **길게 누르기**(`src/lib/useLongPress.ts`) + 대화 상단 안내 한 줄로 옮긴다
  (sr-only 버튼은 최소 44px 가드에 걸린다). ★JSX attribute spread(`{...handlers}`)는 designSystemUsage가
  해석하지 못해 파일 분석이 통째로 중단되므로 prop을 하나씩 연결한다. 사진 확대는 `usePinchZoom`
  (컨테이너 `touch-action:none`), 저장은 `lib/native/mediaSave.ts` → Android `MediaSavePlugin`(MediaStore,
  `WRITE_EXTERNAL_STORAGE`는 maxSdkVersion 28)이며 base64만 네이티브로 넘겨 R2 토큰을 노출하지 않는다.
- ★모달 접근성(2026-07-19): `role="dialog" aria-modal="true"` 화면은 `useDialogFocusLifecycle`로 열림 초점,
  Tab/Shift+Tab 순환, Escape 닫기, 닫힌 뒤 트리거 초점 복원을 보장한다. 제목은 `aria-labelledby`, 필요한 설명은
  `aria-describedby`로 실제 DOM id와 연결하고 스크림 닫기·닫기 버튼을 함께 제공한다.
- ★정보 밀도·이미지 크롭(2026-07-19): 권한·오류·설정 유도 화면은 제목, 한 문장 설명, 현재 상태/경로, 주 CTA,
  보조 CTA 순으로 한 화면에서 훑히게 만든다. 같은 내용을 장문 카드로 반복하지 않는다. 인물/캐릭터 이미지는 예약된
  aspect-ratio와 의도한 `object-position`을 명시해 머리·얼굴이 잘리지 않게 하고, 비핵심 네트워크 이미지는
  `loading="lazy" decoding="async"`로 레이아웃 이동 없이 로드한다. 역할 선택 아이콘처럼 `overflow:hidden`인 슬롯에서는
  원본 상단 여백을 확인하지 않은 확대를 금지한다. 선생님 512×512 원본은 58×58 슬롯에 72×72로 넣으면 위쪽 7px가
  잘리므로 58×58 `contain`으로 맞추며, 회귀는 `tests/imageLoadingContract.test.mjs`가 보호한다.
- ★안전지표·설명문 표면(2026-07-19): 아이 안전지표의 최근 앱·앱 사용 목록은 `DeviceStatusReporter`와
  `deviceHealthView` 양쪽에서 런처·System UI·설정·권한 컨트롤러·시스템 자녀 보호 기능 같은 OS 표면을 제외하되,
  실제 실행 가능한 일반 사용자 앱은 보존한다. 순수 설명문은 `.hy-explain`을 사용해 테두리·그림자 없이 배경과
  아이콘만 유지하고 14px/500/1.55, `word-break:keep-all`, `overflow-wrap:anywhere`, `text-wrap:pretty`로 문장을 읽기 좋게
  나눈다. 오류·경고·재시도·attention·SOS·차단·권한 정책 모달·클릭 카드·데이터 요약은 이 평면화 대상이 아니다.
- ★화면 완결성·성능(2026-07-19): 조회 화면은 loading/error/empty/success/retry를 정직하게 분리하고, 현재 family/user/source
  snapshot hydration이 끝나기 전 입력·저장을 닫는다. busy 버튼은 중복 실행을 막고 상태를 접근성 이름으로 알린다.
  App 정본은 58개 라우트·57개 lazy screen이며 진입 JS는 `tests/routeBundleBudget.test.mjs`의 500,000-byte 미만 예산을 지킨다.

- ★**미등록 체류 출발 중복 근절(2026-07-30)**: `child_stay_presence.grid_key` 는 소수 4자리(≈11m)라 한 체류가
  GPS 지터로 grid 2~4개로 갈리고, 각 grid 가 자기 에피소드로 출발 알림을 발사했다(실사고: "과천동 국립과천과학관
  근처 출발" 4건, D1 확인 시 37.2146/37.2147,127.1007). 판정은 `lib/unregisteredStayPresenceDedupe.ts` 의
  **거친 지역키(소수 3자리 ≈110m) + 10분 쿨다운**으로 하고, `cron/_deliver.ts` 공통 합류점에서 걸러 metadata
  `{stayAreaKey,stayKind}` 를 남긴다. 구버전 행은 같은 제목으로 역산하므로 **앱 재배포 없이 서버 배포만으로 멎는다**.
  cron 은 같은 패스에서 같은 지역의 출발을 1회만 발사하고 나머지는 알림 없이 에피소드만 닫는다. 지역 미상은 fail-open.
  회귀=`worker/tests/unregisteredStayPresenceDedupe.test.mjs`.
- ★**알림 표시 문구 정본(2026-07-30)**: 서버 카피의 선행 이모지(📍🚶✅🕘)는 표시 단계에서
  `transform/notificationsView.cleanAlertTitle` 로 떼어낸다(목록·상세에 이미 3D 아이콘 타일이 있어 중복).
  알림센터·도착 알림·위험 알림·긴급 수신이 모두 이 함수를 통과한다. 위치 끊김 본문은 2문장 이내로 줄이고
  절전 추측 대신 "마지막 확인" 또는 "새로고침하면 지금 위치를 확인해요"만 남긴다.
- ★**네이티브 보간 채움점 생성 중단(2026-07-30)**: 갭(>150m)을 12m 간격 직선으로 메워 `is_estimated=1` 로
  올리던 채움점은 소비자가 없어졌다(경로는 실측점만 실선으로 잇고, 머문 곳·방문 근거에서도 제외). 업로드·D1 행만
  3배로 불렸으므로 `LocationService` 에서 생성을 제거했다(`interpolateLinearPath` 삭제, 상수는
  `ROUTE_MATCH_MIN_GAP_M`). 과거 행은 남으므로 클라의 `isInterpolatedFillPoint` 필터는 유지한다.
  회귀=`tests/nativeLocationTrailRows.test.mjs`.

- ★**표기·기본값 단일 출처(2026-07-30)**: 전화번호는 `transform/phoneFormat.formatPhoneDisplay` 하나만 쓴다
  (계정 화면만 하이픈 없이 보이던 불일치 수정 — 화면별 로컬 포맷터 복제 금지, dirty 판정도 포맷 기준 비교).
  지도 선택 화면의 기본 중심은 `transform/mapCenter.resolveMapCenter`로 **현재 위치 > 집 저장장소 >
  아이 마지막 위치 > 서울** 순서다(서울시청 고정 기본값 금지). 좌표 파싱은 `Number(null)===0` 함정을 막아
  typeof 가드로 무효값을 걸러낸다. 회귀=`tests/formattingAndMapCenter.test.ts`.
- ★**정직한 빈 응답(2026-07-30)**: 서버가 성공했지만 본문이 비면 대답한 척하지 않는다. 아이 AI 대화의
  `res.reply` 빈 문자열은 "지금은 대답을 못 받았어. 잠시 뒤에 다시 말 걸어줘!"로 강등하고 신고 대상에서 뺀다
  (고정 응답 문구 재도입 금지). 주변 소리 기록의 길이 0초 세션은 "청취 없이 종료", 그 외는 "N초 청취"로 적는다.
- ★**출발 알림 톤(2026-07-30)**: 도착=민트 "도착", 출발=라벤더 "출발", 확인 필요(앰버)는 미도착·지연 계열만이다.
  정상 이동인 출발에 경고 아이콘·"확인 필요" 배지를 쓰지 않는다. `arrivalAlertTone`이 단일 출처다.

- ★**유리 헤더가 안 흐려지는 원인 = 진입 모션 `forwards`(2026-09-26 에뮬레이터 실측)**: `hy-rise`/`hy-fadein` 류
  `to { transform: none }` 를 `forwards` 로 채우면 끝난 뒤에도 `translateY(0)` 이 남아 화면 루트가 transform 조상이
  된다. Android WebView(Chrome 124)는 이 상태에서 sticky 헤더의 `backdrop-filter` 를 그리지 않아 스크롤한 본문이
  제목·뒤로가기와 겹쳐 보였다. 진입 모션은 **`backwards` 로만** 채운다(65곳 정리). 데스크톱 Chromium 캡처는 정상이라
  이 결함을 못 잡는다 — 판정은 `adb exec-out screencap` 프레임버퍼로 한다.
- ★**면 재질 누락 점검(2026-09-26)**: 어른 화면의 흰 불투명 판은 `glass.css` 유리 목록에, 유리판 안의 선택지·빈 상태는
  `.hy-tile` 과 같은 낮은 면 목록에 등록한다(선택 상태는 테두리·accent 가 맡는다). 투명도 감소 강등은 끝의
  `.hy-adult` 변수 강등 한 곳이 맡으므로 목록을 media 블록에 다시 복제하지 않는다(초기 CSS 예산 48KB).
- ★**미니앱·학습 화면도 공용 헤더를 쓴다(2026-09-26)**: 뒤로가기는 `hy-press` + `-back` 클래스로 공용 원형 규칙을
  받고, 제목은 `--type-title`, 상단은 safe area + 16px, 주요 버튼은 알약 `--hy-accent-cta` 다. `min-height` 를 가진
  grid 화면은 `align-content: start` — 기본 stretch 가 빈/오류 상태의 카드·버튼을 세로로 늘렸다. 장식 eyebrow
  (`HYENI MINI APPS`)는 두지 않는다. `ScreenQueryState` 도 제목 왼쪽 정렬·재시도 CTA 색으로 맞췄다.
- ★**사진 아바타(2026-09-26)**: `[data-photo="true"] img` 는 `border-radius: inherit` 로 프레임 모서리를 따른다
  (온라인 점 같은 형제 배지를 자르지 않도록 `overflow: hidden` 대신 상속).
- ★**되돌릴 수 없는 삭제는 두 번 탭(2026-09-26)**: 장소·위험구역 휴지통은 첫 탭에 "한 번 더 눌러 삭제" 알약으로
  펼쳐지고 5초 안의 두 번째 탭에서만 삭제한다(설정 로그아웃과 같은 패턴). 회귀=`tests/placeManagerDeleteConfirm.test.mjs`.
- ★**다자녀 전환은 공용 알약 하나(2026-09-26 TK 제보)**: `src/components/ChildSwitcher.tsx` 가 전역 활성 아이만 바꾼다.
  부모 홈 맨 위가 정본 자리이고 위치(지도 위)·대화(고정 헤더 둘째 줄)·숙제/준비물·안심 리포트·아이 대시보드·하루 요약·
  위치 상태에도 같은 알약을 둔다. 홈 "아이 현황" 카드는 상세만 연다(선택+이동 겸용 금지). 아이 세션·아이 1명이면 그리지 않는다.
  소리 울리기·칭찬 스티커처럼 원격 동작 대상을 고르는 화면은 화면 안 명시 선택을 유지하되 `hy-kidswitch__item` 모양을 쓴다.
  아이 추가 마법사는 이미 아이가 있으면 "몇 명?" 단계를 건너뛰고, 고를 단계가 없는 화면(최대 인원·프리미엄 안내)엔 진행 표시를 두지 않는다.
- ★**모션 정본(2026-09-26)**: 라우트 화면 루트는 `.hy-app .hy-screen > *` 한 규칙이 진입 모션을 맡는다(상세=아래에서 36px
  올라오며 0.42s `--easing-emphasized`, 탭=10px 0.28s). 화면별 진입 페이드는 이 규칙이 덮는다. 바닥 시트는 `hy-sheetup`
  (자기 높이 100%에서 0.46s). 누름은 90ms 로 들어가고 0.36s 스프링(`--easing-cheer`)으로 돌아온다. 탭·아이 전환은
  `lib/haptics.selectionHaptic`(8ms)으로 손끝에 알린다. 모두 `backwards` 채움 — transform 을 남기지 않는다.
- ★**라벨은 목적지와 같은 말(2026-09-26)**: 부모 탭은 아이콘+라벨, 아이 독도 라벨을 보인다. 같은 기능은 같은 이름
  (대화 탭·위치 액션·아이 상세 모두 "대화"). 부모 위치 액션의 경로 버튼은 아이의 다음 일정 가는 길이라 "길찾기"가 아니라
  "일정 가는 길"이다(부모가 아이에게 가는 길로 오해했다). 바로가기 "위치추적"→"이동 기록"
  (감시 어휘 금지·실제 목적지가 이동 기록), "학원표"→"학원 시간표", 홈 헤더 "스티커"→"칭찬하기", "지금 갱신"→"새로고침".
  설정은 하단 탭 화면이라 뒤로가기를 두지 않고, 시간대는 IANA 원문 대신 `timeZoneOptionLabel` 로 보인다.
- ★**화면 안 모달의 층(2026-09-26 S25 실기기)**: `.hy-adult .hy-screen` 은 `isolation: isolate` 라 화면 안에서 연
  모달(`aria-modal`)의 z-index 가 그 안에 갇혀 탭바(z 45) 밑에 깔렸다(프리미엄 안내의 "무료로 계속"·벨 확인 scrim).
  `glass.css` 의 `.hy-adult .hy-screen:has([aria-modal="true"])` 가 열린 동안만 화면을 z 46 으로 올린다. 그러니 바닥
  시트 루트에 탭바 자리(80px) 패딩을 두지 않는다 — 시트는 바닥에 붙이고 safe area 만 더한다.
- ★**입력·선택 표시(2026-09-26)**: 입력창은 터치로도 `:focus-visible` 이 켜지므로 `:where(.hy-app) :is(input,textarea,select)`
  가 파란 3px 링 대신 `--hy-accent-cta` 2px 둥근 링을 쓴다(화면별 `.cls:focus-visible` 조정이 이긴다). placeholder 굵기는
  전역 400 하나 — 화면 CSS 에서 600·700 으로 다시 올리지 않는다. 어른 칩 선택은 글자색만으로는 유리 위에서 안 보여
  `inset 0 0 0 2px color-mix(currentColor 70%)` 링을 두른다(아이 전환 알약과 같은 언어).
- ★**한국어 줄바꿈(2026-09-26)**: `html:lang(ko)` 에 `word-break: keep-all; overflow-wrap: break-word`. 중국어·일본어는
  띄어쓰기가 없어 keep-all 을 걸지 않는다. `overflow-wrap: anywhere` 를 전역에 쓰지 않는다 — min-content 가 한 글자로
  줄어 알약·칩이 글자 단위로 접힌다.
- ★**판 없는 섹션은 자르지 않는다(2026-09-26)**: 부모 홈의 일정·AI 일정 추가·바로가기 섹션은 판을 걷어 내고 패딩 0 이라
  `overflow: hidden` 이 남으면 제목 첫 글자('AI'의 A)와 버튼 그림자가 잘렸다 — 투명 섹션은 `overflow: visible`.
- ★**상태바·실패 화면(2026-09-26)**: 지도가 상태바 밑까지 깔리는 화면(부모 위치)은 상태바 몫만 흐린 유리(`.pl-root::before`)로
  덮어 시계·배터리를 읽히게 한다. 화면 전체 조회 실패는 `ScreenQueryState embedded state="error"` 카드 하나로 보인다
  (글자+작은 버튼·전체폭 버튼·검은 알약이 섞여 있었다). WebView `<input type="date|time">` 선택기는 Android 테마
  `colorAccent`(`picker_accent`, 라벤더 CTA)를 따른다 — 미지정이면 AppCompat 청록으로 떴다. 선택기의 '삭제'가 보내는
  빈 값은 일정 시간이면 '하루 종일'로, 날짜·시간 범위 설정이면 무시한다.
- 초기 CSS 는 47,919/48,000바이트다. 전역 규칙을 더 넣을 때는 기존 중복부터 줄인다.
- ★**문구 밀도(2026-09-26 TK 제보 "텍스트가 너무 많다")**: 한 화면에서 같은 사실을 두 번 말하지 않는다. 행 부제는 제목을 반복하지
  않는 짧은 명사구(알림 토글 "도착·출발 소식", 아이 상세 "무음이어도 최대 볼륨")이고, 섹션 제목 아래 설명 문장
  (안심 리포트 "…함께 봅니다", 가족 "연결할 사람을 먼저 선택하면…", AI 일정 "말하거나, 쓰거나…")은 두지 않는다. 상태가 정상일 때
  "꺼져 있으면 지연될 수 있어요" 같은 조건부 경고는 숨긴다(위치 상태 화면은 실패·확인 중에만). 잠긴 미리보기 칸은 칸마다 같은
  설명을 쓰지 않고 자물쇠 아이콘 하나로 대신한다. 받은 적 없는 혜택의 "종료" 안내나 연결된 계정이 없는데 해제 규칙을 말하는
  문장처럼 사용자 상태와 무관한 안내는 조건으로 숨긴다. 법적·안전 고지(구독 자동 갱신·체험 취소, 원격 청취의 아이 표시·1분·기록,
  "최근 보고 기준")는 뜻을 유지한 채 짧게만 줄인다. 측정은 실기기 CDP 로 블록별 글자 수·줄 수를 재서 42자 이상·3줄 이상 문단과
  14자 이상 버튼을 먼저 본다.
- ★**대화 화면은 화면 전체(2026-09-26 TK 제보)**: 입력줄 아래에 앱 하단 메뉴와 휴대폰 내비게이션이 겹겹이 쌓이면 이상해 보인다.
  `AppShell` 의 `CHAT_PATHS`(`/parent/memo`·`/child/memo`)에서는 부모 탭바·아이 독을 그리지 않고, `.hy-app[data-chat="true"]`
  가 입력줄을 safe area 바로 위에 붙인다. 이동은 대화 헤더의 뒤로가기(`useSafeBack` — 기록이 없으면 역할 홈)다. 아이 SOS 는
  홈·스티커의 독과 홈에서 쓴다(AI 친구 대화와 같은 규칙). 회귀=`tests/memoComposerDesign.test.mjs`.
- ★**홈 히어로 슬라이드는 한 높이(2026-09-26 TK 제보)**: 오늘 요약(168px)과 소식(혜니스터디, 152px) 카드 높이가 달라 넘길 때
  크기가 바뀌어 보였다. 슬라이드는 flex 로 가장 긴 카드에 맞추고, 소식 카드는 같은 세로 배치(위 라벨·제목·아래 한 줄)와 같은
  캐릭터 칸(128×146)을 쓴다.
- ★**히어로 아래 조작(2026-09-26 TK 제보)**: 흰 원형 버튼 두 개가 히어로보다 무거웠다. 화살표는 배경 없는 18px·1.8 선, 누를 때만
  `::before` 옅은 원, 점은 44px 터치 영역을 유지한 채 -12px 로 모아 한 페이지 표시로 읽힌다.
- ★**홈 카드 재질 통일(2026-09-26 TK 제보)**: "아이 기기 찾기" 카드만 조작 버튼 재질(`ph-neu-control`, 흰 1px 테두리·안쪽 광택)이라
  옆 "아이와 대화하기" 카드와 테두리가 달랐다. 홈의 행형 카드는 `ph-section-shell ph-glass ph-memo` 한 가지 판을 쓴다.
- ★**온보딩 첫 화면·가족 연결(2026-09-26 TK 제보 "국가 선택 화면이 깨진 것 같다")**: 온보딩의 판(역할 카드·설문·초대 코드·
  시간대·이용 국가·연결 카드·권한)은 모두 정본 유리 토큰(`--ph-glass-fill`·`--ph-panel-shadow`·`--ph-glass-blur`) 하나로
  칠한다(학부모만 정본 유리, 나머지는 테두리 유리·흰 판이 섞여 있었다). 첫 화면 언어 선택(`LanguageSelector collapseOthers`)은
  판 하나 안에 지구본·현재 언어 행과 구분선 아래 목록만 둔다(흰 카드 안 회색 알약 안 흰 목록 카드 금지). 펼치면 목록이 보이게
  스스로 굴린다. 로고·역할 카드 묶음은 남는 높이의 가운데에 둔다. 가족 연결 단계의 선택칸은 초대 코드 입력칸과 같은
  52px·radius 16·body-lg 이고, 흰 판 위 흰 칸이 되지 않게 판을 유리로 둔다. 빈 `<input type="date">` 는 Android WebView 에서
  빈 상자로만 보이므로 `components/ui/DateField` 로 안내 문구를 겹친다(생년월일 3곳). 설문 선택은 공용 유리 목록보다 높은
  우선순위의 `outline` 링 + 옅은 강조 채움이다.
