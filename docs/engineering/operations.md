# 기기·운영 작업 참고

이 문서는 2026-09-12에 자동 지침에서 분리한 작업별 참고 자료입니다. 관련 항목만 찾아 읽으세요.
날짜가 붙은 배포·기기·자격 상태는 당시 관측이며, 현재 상태는 해당 작업에서 확인합니다.
작업 범위와 승인·완료 기준은 루트 `AGENTS.md`와 현재 사용자 요청을 따릅니다.

## 절대 안전 규칙

1. **실사용 기기 보호**: 2026-08-19 최신 사용자 지시 기준 실기기 검증기는
   **A17(RFKL40DP73J) 부모 · razr(ZY22H9VTQD) 아이 · S25(R5CY521CFNZ, SM-S937N)** 세 대다.
   세 기기 모두 현재 역할·세션을 유지하고 `npm run android:install:debug -- <serial>`로 기본 사용자(0)에만
   `adb install --user 0 -r`하여 앱 데이터·계정·페어링·세션을 보존한다. `--user 0` 없는 adb 설치는
   Samsung DUAL_APP 프로필에도 복제되어 아이콘이 두 개 생길 수 있으므로 금지한다.
   실제 계정 로그아웃·역할 전환·재페어링을 하지 않는다.
   ⚠️ S25는 2026-08-02~08-19 검증 제외였다가 TK 지시로 복귀했다. **A17·razr 와 달리 고정 역할이 없으므로**
   역할 의존 검증 전에 CDP 세션 확인(아래)으로 역할을 먼저 확정한다.
   refresh 토큰은 출력·복사·회전하지 않는다.
2. **라이브 refresh 토큰 조작 금지** — 회전시키면 앱 세션이 파괴된다. access 토큰만 읽기.
   2026-07-10부터 refresh 체인은 **기기 바인딩**(device_install_id 스탬핑) — 외부에서 토큰 사본으로 회전 시도하면 401이 정상이다.
   세션이 유실된 아이 기기는 딥링크 `#/onboarding?pair=KID-…` 재페어링이 정답(previous_user_id 힌트로 같은 uid 무손실 복구).
   2026-08-20부터 인증 계정은 `account_device_sessions`로 **동시에 한 설치만 활성**이다. 비밀번호·OAuth·페어링처럼
   사용자가 다시 본인 인증한 새 로그인은 활성 설치를 새 기기로 원자 전환하고, 이전 refresh 체인·FCM/Web Push endpoint와
   실시간 소켓을 즉시 닫는다. 따라서 기존 기기를 잃어 로그아웃할 수 없어도 새 기기로 들어갈 수 있고, 이전 기기는 곧바로
   가족 정보를 읽거나 받지 못한다. 반대로 **refresh만으로는 설치를 인계하지 못하며** 비활성 기기 refresh는 401이다.
   운영은 `worker/db/account-device-sessions.sql`을 Worker보다 먼저 적용하며 라이브 계정으로 전환을 억지 재현하지 않는다
   (`worker/tests/accountDeviceSession.test.mjs`가 정본).
3. **파괴적 작업 전 안전 불변식 확인**(예: 아이 페어링 전 프리미엄 캡 확인 — 기존 아이가 밀리지 않는지).
4. 테스트로 만든 데이터·바꾼 설정은 **반드시 원복/삭제**. 비밀번호는 사용자만 입력.
5. 프로덕션 D1 파괴적 삭제·스토어 배포·시크릿 변경 금지.

## 실기기 검증 치트시트

- ★**"브라우저에서만 안 된다" 진단 순서(2026-08-18)**: ①D1 행 ②R2 객체·customMetadata(`wrangler dev --remote`
  로 띄운 읽기 전용 스크래치 워커의 `PHOTOS.head`) ③격리 브라우저에서 같은 계약으로 재현 ④그래도 정상이면
  **탭이 들고 있던 옛 번들**을 의심한다(옛 클라이언트가 사라진 응답 필드를 요구해 화면이 오류가 된다).
  `registerSW`의 `onRegisteredSW` 가 30분마다·화면 복귀마다 `registration.update()` 를 돌려 자가 회복시킨다.
  친구 초대 코드는 계정이 아니라 **가족** 스코프이고 조회는 활성 보호자 전원, 만들기·변경만 주 보호자다
  (응답의 `canManage`). 0행 UPDATE 를 성공처럼 돌려주지 않는다.
- ★**화면이 "한 번씩 리프레시"되는 두 원인(2026-08-18 제보, 2026-08-20 정본)**: ①과거 Android
  네이티브에서도 PWA Service Worker를 등록해 새 APK 직후 옛 화면이 한 번 뜨거나 사용 중 reload가 일어났다.
  Capacitor는 APK 자산을 직접 읽으므로 이제 `main.tsx`가 네이티브에서는 Service Worker를 등록하지 않고 과거 등록도
  `unregister()`한다. 웹·PWA만 `registerSW` 업데이트·오프라인·웹 푸시 계약을 유지한다. 구버전에서 처음 올라오는
  1회는 옛 controller가 먼저 응답할 수 있어 앱을 한 번 다시 열어 최신 번들을 읽으면 등록이 영구 정리된다.
  ②화면은 route 단위 lazy 청크라 첫 진입에 `RouteLoading` 이 지나간다 — `src/app/routePreload.ts` 등록소 +
  탭바·아이 독의 idle/pointerdown 프리로드로 없앴다. `lazyScreen.preload()` 는 실패한 promise 를 캐시하지 않는다.
  `LocaleBoundary` 는 문구 로딩 중 빈 화면 대신 `RouteLoading` 을 렌더한다. 회귀=`tests/routePreload.test.ts`.
- ★**`adb install --user 0 -r` 직후 번들 신선도(2026-08-20 정본)**: 구버전에서 이 수정 버전으로 처음 올라오는 경우만
  옛 Service Worker가 1회 응답할 수 있다. ①APK 진입 asset 확인 ②앱 1회 재시작 ③CDP에서 활성 진입 asset과
  `navigator.serviceWorker.getRegistrations()` 길이 0을 확인한다. 이후 네이티브는 APK 자산을 바로 읽으며 SW를
  다시 등록하지 않는다. 웹/PWA의 Service Worker는 그대로 유지한다.
- ★**대기 중 애니메이션은 꺼진 화면에서 관측할 수 없다**: 화면이 꺼진 WebView 는 `document.hidden === true` 라
  배회·깜빡임이 설계대로 멈춘다. 밤에 아이 기기를 깨우지 말고, 시간축 동작은 격리 Chromium + dist + 아이 세션만
  심은 하니스로 관측한다(`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` 로 외부 호스트를 닫는다).
- ★**CDP 스크린샷은 디자인 판정용이 아니다(2026-07-30)**: Android WebView 의 `backdrop-filter`·`filter`
  레이어를 합성하지 못해 히어로 카드가 흐릿하게/텍스트가 겹쳐 보이는 **캡처 아티팩트**가 난다. 실제 화면
  판정은 `adb -s <serial> exec-out screencap -p > out.png` 프레임버퍼로 하고, CDP 는 DOM·상태·클릭에만 쓴다.
  리뷰용으로는 sharp 로 width 420 축소본을 만들어 본다(원본 1080×2340 은 토큰만 먹는다).
- ★**모의 API 브라우저 스윕으로 전 화면·전 버튼을 안전하게 검증한다(2026-07-30)**: ms-playwright 캐시의
  chromium 을 `--headless=new --remote-debugging-port` 로 띄우고 `Fetch.enable` 로 **외부 요청 전부 가로채**
  mock JSON 으로 닫으면 실계정·실서버·실기기에 영향 없이 부모/아이 세션을 만들어 버튼을 전부 누를 수 있다.
  주의: ①`window.kakao.maps` 계측 스텁을 주입해야 지도 화면이 뜬다(JS 키 도메인 제한) ②fixture 는 서버 계약을
  정확히 따라야 한다(`events_children[{child_id}]`, `notif-settings.quiet_hours{enabled,start_minute,end_minute,
  updated_at,configured}` — 틀리면 화면이 정직하게 error/fail-closed 로 닫혀 오탐이 된다) ③외부 링크(스토어 등)
  클릭으로 페이지가 앱을 떠나면 `Page.navigate` 로 절대 URL 복구가 필요하다 ④5173 포트는 다른 프로젝트가 쓸 수 있다.
- ★**디자인을 계측으로 검수할 때 숫자를 믿기 전에 걸러야 하는 6가지(2026-07-30 — 전부 실제로 오판)**:
  같은 스윕에 대비·반경·폰트·터치타깃·오버플로 계측을 얹으면 눈으로 못 보는 결함이 나오지만, 아래를 안 걸러내면
  결과가 거짓말을 한다. ①**비활성 컨트롤은 WCAG 대비 면제** — `:disabled` 를 섞으면 "저장 버튼이 최악(1.74:1)"이라는
  오진이 난다 ②**가로 스크롤 행의 자식·`overflow:hidden` 장식은 오버플로가 아니다**(조상 `overflowX` 확인)
  ③**런타임 대비 계측은 그라디언트 채움을 못 본다** — 배경 이미지라 배경색이 없어 계산을 건너뛴다. 정적 CSS 스캔을
  병행해야 한다(이 맹점 때문에 저장·전송 버튼 18곳의 2.0:1 이 런타임 0건으로 보였다) ④**SVG `className` 은 문자열이
  아니다**(`SVGAnimatedString`) → `getAttribute("class")` 로 읽어야 lucide 스피너를 안 놓친다 ⑤**로딩 상태는 라우트마다
  새 문서를 띄워야 보인다** — hash 만 바꾸면 TanStack Query 캐시로 이미 끝난 상태가 측정된다(첫 측정 전체 무효).
  `Page.navigate`+`Page.reload` → BootSplash 1.6초 게이트 통과 → mock 3초 지연 응답 전(≈2.4초)에 읽는다
  ⑥**"움직이는 요소 있음"으로 진행 표시자를 판정하지 않는다** — 진입 페이드·마스코트 부유가 다 걸려 전부 통과처럼
  보인다. `[aria-busy]`·`[role=status]`·skel/loading/spin 맥락 안의 애니메이션만 센다.
  ⑦**dist 로 만든 정적 하니스는 진입 CSS 만 링크하면 안 된다(2026-08-19 실측 오판)** — 화면 컴포넌트 CSS 는
  route lazy 청크(`assets/Loading-*.css`·`ScreenQueryState-*.css`)로 갈라져 나가므로 `assets/index-*.css` 만
  링크하면 그 규칙이 조용히 빠지고 커스텀 속성이 기본값으로 되돌아간다(로더 44/72px 지정이 64px 로 측정됐다).
  `grep -l <클래스> dist/assets/*.css` 로 실제 청크를 찾아 전부 링크하고, 순서도 진입 CSS 다음에 둔다(런타임과 같은 순서).
- ★**진행 표시자는 화면마다 만들지 않는다(2026-07-30)**: `components.css` 의
  `button[aria-busy="true"]:not(.hy-busy-quiet)::before` 가 `currentColor` 회전 링을 자동으로 붙인다.
  새 화면은 `aria-busy={<진행 식>}` 만 정확히 켜면 된다(`disabled` 식에서 **진행 항만** 골라야 한다 — 유효성 항까지
  넣으면 그냥 못 누르는 버튼이 '작업 중'으로 잘못 알려진다). 자기 스피너를 그리는 버튼은 `hy-busy-quiet` 로 제외한다.
  가드=`tests/progressIndicatorContract.test.mjs`.
  ★**아이콘만 있는 원형 버튼은 `hy-busy-center` 를 함께 붙인다(2026-08-17 TK 제보)**: 공용 링은 `::before` 로
  flex 행에 끼어들어 라벨 왼쪽에 붙는 설계라, 라벨이 없는 원형 버튼에서는 아이콘을 밀어내 글리프가 치우쳐 보인다
  (채팅 보내기 비행기). `hy-busy-center` 가 링을 절대 배치로 가운데 겹치고 자식(아이콘)만 감춘다 —
  버튼 크기·아이콘 위치는 그대로다. 자기 펄스/스피너를 겹쳐 두 표시자로 만들지 말 것.
- ★**화면 로딩은 공용 로딩 마크 하나로 통일(2026-08-19 TK 지시)**: 점 3개·반짝임·회전 링이 화면마다 달랐다.
  이제 `src/components/ui/LoaderMark.tsx` 한 곳이 그림을 정하고 **일반 로딩=`loader-calendar`**,
  **지도·경로 로딩=`loader-location`** 두 가지만 쓴다. 소비처는 `Loading`·`RouteLoading`·`ScreenQueryState`(loading
  상태)·`KakaoMap`(`.km-skeleton`)·`RouteView`(`.rv-map--placeholder`) 5곳이다.
  ⚠️ **애니메이션 webp 는 CSS 로 멈출 수 없다** — 그래서 컴포넌트가 `<picture>` +
  `media="(prefers-reduced-motion: reduce)"` 로 **정지 프레임(`-still.webp`)** 을 대신 내려준다.
  정지본은 루프 중간(18/36) 프레임이다. 마지막 프레임(체크 완료·하트)을 쓰면 로딩 중인데 "끝났다"로 읽힌다.
  크기는 소비 화면 CSS 의 `--loader-mark-size` 로만 정한다(공용 컴포넌트에 인라인 style 로 크기를 주면
  소비 화면 클래스를 덮어쓴다 — `KakaoMap` 지도 실종 사고와 같은 함정). 마크는 `aspect-ratio: 1/1` 이라
  `.km-skeleton` 처럼 폭에 `clamp(40px, 38%, 96px)` 를 줘도 정사각을 유지한다.
  **그대로 둔 것**: 버튼 안 `aria-busy` 회전 링(라벨 옆 인라인 표시자), `hy-skel` 스켈레톤(레이아웃 자리표시),
  스플래시의 점 3개(콜드스타트 브랜드 연출), 지도 위 `rv-map-chip` 스피너(작은 칩).
  자산 정본=`scripts/import-loader-marks.mjs`(원본 파일→slug 표, q88 재인코딩 + 정지 프레임 생성).
  가드=`tests/progressIndicatorContract.test.mjs`(소비처 5곳·`--loader-mark-size`·webp `ANIM` 청크 유무로
  "애니메이션 본 / 정지본"을 파일 단위 검증)·`tests/mapPerf.test.ts`·`tests/routeLazyLoading.test.mjs`.
- ★**진행 표시자는 한 화면에 하나만 움직인다(2026-08-17 TK 제보)**: 부모 위치 화면은 갱신 중에
  ①아이 칩의 "위치 요청을 보냈어요" 문구 ②칩 폭 확장 ③칩 스피너 ④우상단 새로고침 회전을 동시에 했고,
  사용자에게는 "프로필 위에 문구가 겹치고 버튼이 따로 움직인다"로 보였다. 지금은 **새로고침 버튼 회전 하나**만
  진행을 알리고 아이 칩은 정지 상태를 유지한다(`parent.location.requestSent` 재도입 금지).
  상세 카드는 갱신 중에도 마지막 확인 시각·정확도를 그대로 보여 준다(빈 문구로 바꾸지 않는다).
  가드=`tests/parentLocationUi.test.mjs`.
- ★**부모 프로필 사진(2026-08-17 TK 요청)**: 업로드 purpose 는 `parent_profile` 이고 대상은 **항상 caller 본인
  멤버 행**이다(주 보호자도 남의 부모 사진을 대신 못 바꾼다). 서버는 세 곳에서 같은 소유권을 확인한다 —
  `authorizeChildPhotoUpload`, `storageInvalidUploadCleanup` 의 journal INSERT **SQL 분기**(kind 를 추가하고
  분기를 안 넣으면 업로드가 `storage_journal_unavailable` 503 으로 조용히 막힌다), `/api/family/member/photo`
  (주 보호자 아니면 본인 멤버 + `{familyId}/uploads/{본인}/{uuid}.{ext}` 키만). 조회는 `profile` 과 같은 판정이라
  같은 가족 아이·공동 보호자가 아바타를 볼 수 있다.
  ⚠️ 멤버 `photo_url` 은 R2 객체 키라 그대로 `<img src>` 에 넣으면 화면에 안 나온다 — `queries/memberPhotos.ts`
  의 `useResolvedMemberPhotoUrls` 로 표시용 blob URL을 만들고 `useMyFamily`·`useAccount` 가 이 한 곳을 공유한다.
  부모 아바타 기본값(성별 캐릭터)은 `lib/avatar.ts parentAvatarPath` 단일 출처다.
  가드=`tests/parentProfilePhoto.test.mjs`·`worker/tests/storageObjectAuthorization.test.mjs`.
- ★**라우트 namespace 누락 = 화면에 원시 message id(2026-08-17 실기기 확인)**: namespace 는 화면을 지나며
  누적되므로 다른 화면을 먼저 들른 세션에서는 가려지고, 콜드 스타트로 그 화면에 바로 들어가면 문구가 id 로 보인다.
  `/subscription`(열 제목 `parent.tier.free`)·`/place-manager` 계열(제목 `notifications.placeManager.title`)·
  부모 위치 상태 칩(`child.state.checking`)이 실제로 그랬다. `routeElement` 의 GROUP 은 화면이 쓰는 모든
  namespace 를 포함해야 하고, 공용 transform(`tierPolicy`·`premiumUpsell`)이 만드는 문구도 화면 몫으로 센다.
  부모 라우트에서 `child.*` 문구를 쓰지 않는다. 가드=`tests/i18nUiWiring.test.mjs`.
  ⚠️ 눈으로 훑는 스윕은 이 결함을 놓친다 — hash 만 바꾸며 도는 하니스는 앞 화면의 namespace 를 이미 갖고 있다.
- ★**정책 숫자는 DB CHECK 에도 박혀 있을 수 있다(2026-08-17)**: 친구 초대 보상을 10→50회로 올리고 3가족 상한을
  없앨 때 코드만 고치면 `family_setup_retryable` 503 이 났다 — `reward_credits = 10`·`successful_referrals BETWEEN 0 AND 3`
  CHECK 가 원인이었다. D1 은 CHECK 를 ALTER 로 못 바꿔 테이블 재작성이 필요하고, 그 테이블을 본문에서 참조하는
  트리거는 **같은 migration 파일에서 DROP → 재작성 → CREATE** 해야 한다(아니면 전체 롤백).
  지급액은 상수가 아니라 완료 행의 `reward_credits` 를 쓴다(정책이 바뀌어도 약속한 금액을 지킨다).
  공유 URL 정본은 `/?ref=HYENI-…`(해시 금지 — 메신저가 fragment를 버린다. `/invite` 도 읽는다). 「친구에게 공유」는
  시스템 공유 시트이고, 가입·가족 연결에서 링크/코드를 직접 넣을 수 있다. 새 가족 만들기에만 귀속한다.
- ★**문구 길이는 ICU 분기별로 재라(2026-08-17)**: `locales/ko/*.json` 의 원문 길이는 select 분기가 다 합산돼
  과대 계상된다. 실제 화면 길이는 분기별 최대 렌더 길이로 재야 하고(파서로 AST 를 훑는다), 그 기준으로 60자를
  넘는 문구는 축약한다. 남기는 예외는 삭제 경고·Play 정책 고지·숨은 운영자 화면뿐이다.
  10개 locale 을 같이 고치고 `node scripts/i18n/build-catalogs.mjs` 로 생성물을 갱신한다.
- ★**새 문구는 세 곳을 함께 고쳐야 화면에 나온다(2026-08-19 실측)**: `locales/<locale>/*.json` 10개만 고치면
  화면에는 여전히 `child.aiChat.voice.speaking` 같은 **원시 id** 가 보인다. 런타임이 읽는 건 커밋된 생성물
  `src/i18n/generated/catalogs/**` 이고, 빌드 파이프라인이 그걸 다시 만들어 주지 않기 때문이다. 순서는
  ①10개 locale JSON ②`locales/descriptions.json` 에 같은 키 추가(namespace·audience·qualityTier·description —
  없으면 `missing_description:<id>` 로 생성이 **실패**한다) ③`node scripts/i18n/build-catalogs.mjs` ④`npm run build`.
  ⚠️ 이 함정은 테스트로 안 잡힌다 — locale JSON 만 보는 테스트는 통과하고, 화면에서만 id 가 보인다.
  브라우저 하니스로 실제 문구를 눈으로 확인하는 게 유일한 확인 방법이다.
- ★**사용자 노출 literal 게이트(2026-08-25)**: `npm run i18n:scan`(=`scripts/i18n/scan-user-facing-literals.mjs`).
  한글 문자를 세지 않고 **AST 로 사용자에게 보이는 자리**를 먼저 특정한다 — JSX text, 문구 attribute
  (`aria-label`/`title`/`placeholder`/`alt`/`label`/`description`… 20종), toast·dialog·validation sink
  (`show`/`toast`/`alert`/`confirm`/`setError`… 와 `toast*.show` 류), `document.title`. 그 자리에 도달하는 값이
  message API(`formatMessage`·`localizeApiError`·`format*`)를 거쳤는지 본다. 값 흐름은 **모듈을 건넌다**
  (`aiBuddyVoiceHint` → `aiBuddyFabPrompt` → `AiBuddyFab` 3파일을 관통해 잡는다).
  ⚠️ `cond && <JSX>` 의 값은 **우변뿐**이다 — 좌변까지 보면 조건 이름 하나 때문에 큰 JSX 블록이 통째로 오탐된다.
  ⚠️ 속성 접근은 객체 shape 를 찾아 **그 속성만** 판정한다. `cond ? build() : null` 의 `null` 분기는
  "모양 미상"이 아니라 "기여하는 모양 없음"으로 처리해야 한다(미상으로 두면 같은 객체의 다른 라벨 때문에
  `sheetView.title` 같은 사용자 데이터가 오탐된다).
  ⚠️ 라틴 문자열은 **토큰 전부가 기계 식별자면** 문구가 아니다(`kdock__tab hy-press`). 문자열 전체로만 검사하면
  공백 때문에 "두 단어 문장"으로 오판한다.
  allowlist(`scripts/i18n/user-facing-literal-allowlist.json`)는 두 상태를 구분한다 —
  `exempt`(번역 대상 아님, `data|protocol|brand|bootstrap|accessibility|admin|legal|dev|universal:` 접두어 강제)와
  `pending-migration`(**면제가 아니다**, 면제 접두어 금지 + `plan`·`migrateTo` 강제). 쓰이지 않는 항목은 실패하므로
  이관을 마치면 항목을 지워야 한다. 현재 `pending-migration` 항목이 곧 미이관 결함 목록이다.
  회귀=`tests/userFacingLiteralScan.test.mjs`(저장소 위반 0 + fixture 행위검증을 함께 본다 — 위반 0만 검사하면
  스캐너가 아무것도 못 잡는 상태로 퇴행해도 초록으로 보인다).
- ★**문구 이관은 "키 표만 남기기"다(2026-08-25, 위치 권한 고지 실측)**: 공용 컴포넌트에서 원문 표
  (`FORMAL_COPY`/`CHILD_COPY`)를 지우고 **키 목록 + `copyMode` 로 고르는 id 접미사**만 남긴다
  (`shared.locationPermission.<key>.{child|formal}`). 톤은 접미사로만 갈리고 컴포넌트는 문구를 모른다.
  ⚠️ **namespace 는 그 컴포넌트를 쓰는 모든 라우트 그룹에 로드돼 있어야 한다.** 위치 권한 다이얼로그는
  onboarding(`copyMode="formal"`)·아이 홈·아이 위치(`copyMode="child"`) 세 곳에서 쓰이므로 `shared` 가
  유일한 정답이다 — `onboarding` 에 두면 아이 화면에서 원시 id 가 보인다(`CHILD_NAMESPACES=core,child,shared`).
  ⚠️ **죽은 중복 id 함정**: 이관 전에 `locales/` 에서 같은 문구를 먼저 찾아라. 위치 권한 고지는 이전 task 가
  `onboarding.locationDisclosure/backgroundPermission/permissionDenied.*` 21개 id 를 10개 언어까지 번역해 두고
  컴포넌트를 재배선하지 않아, 화면은 계속 원문 한국어였고 catalog 에는 아무도 읽지 않는 번역이 남아 있었다.
  `validate-catalogs` 는 **미사용 id 를 잡지 못한다** — literal 게이트가 실제 결함을 지목한 뒤에야 드러났다.
  재사용하면 번역 품질을 그대로 얻고, 옮긴 뒤에는 원래 id 를 지워 정본이 둘로 갈리지 않게 한다.
  ⚠️ 지금 화면에 보이는 한국어와 재사용 id 의 ko 값이 다르면 **화면 쪽을 정본으로 삼는다**(사용자에게 보이는
  문구를 조용히 바꾸지 않는다). 실제로 3곳이 달랐다(`내 위치 공유 안내`·`골라 줘`·`권한 없이 계속`).
- ★**다국어 PWA manifest·문서 metadata(2026-08-25)**: `npm run i18n:manifests` 가 `locales/manifest.json` +
  `core.brand.name`/`core.brand.description` 으로 `public/manifests/manifest.<locale>.webmanifest` 10개를 만든다
  (`--check` 로 stale 검사). 설치된 앱 이름·설명은 `<html lang>` 이 아니라 manifest 가 정한다.
  ⚠️ 경로는 **manifest URL 기준 상대 경로**다 — manifest 가 `/manifests/` 안이므로 `start_url`·`scope`·아이콘이
  `../` 여야 한다(`./` 로 두면 설치된 앱의 시작 URL 이 `/manifests/` 가 된다). `base:"./"`(Capacitor `file://`)
  때문에 절대 경로는 쓸 수 없다. ⚠️ 아이콘 URL 은 10개 manifest 가 **동일**해야 Workbox precache 에 같은 자원이
  다른 revision 으로 겹치지 않는다. ⚠️ VitePWA 는 자기 단일 언어 manifest 링크를 index.html 에 주입하므로
  `vite.config.ts` 의 `singleLocaleManifestLinkPlugin` 이 그것을 지우고 `#hyeni-manifest` 하나만 남긴다 —
  **이 플러그인에 `enforce:"post"` 가 없으면 주입 전 HTML 을 보고 조용히 통과한다**(실제로 겪은 결함).
  생성된 `manifest.webmanifest` 파일 자체는 지우지 않는다(`scripts/lib/pwaPrecacheManifest.mjs` 계약이 전제).
  런타임 갱신 정본은 `src/i18n/documentMetadata.ts` `applyDocumentLocale`(lang·dir·title·
  `apple-mobile-web-app-title`·`#hyeni-description`·`#hyeni-manifest`). core catalog 이 없으면 설명을 지어내지 않는다.
  Service Worker 는 `HYENI_LOCALE` 메시지로 **locale 코드만** 받아(계정·세션 값 금지) title 없는 web push 의
  브랜드 폴백을 사용자 언어로 만든다. 회귀=`tests/pwaLocaleMetadata.test.mjs`.
- ★**descriptions.json 고아 키 게이트(2026-08-25)**: `validate-catalogs.mjs` 의 기존 대조는 `entry.namespace` 가
  실제 namespace 와 같을 때만 돌아 **namespace 값 자체가 어긋난 항목**(스크립트 오류 문자열이 키로 새어 들어온
  `"Error: child.…"` 1건)을 놓쳤다. 이제 `description_invalid_namespace`/`description_orphan_id` 로 잡는다.
  통합 실행은 `npm run i18n:verify`(catalog 검증+생성물 최신+manifest stale+literal 게이트+오류 표면).
- ★**표는 열 폭을 먼저 고정한다(2026-08-17 TK 제보 "플랜 비교 줄바꿈이 난잡함")**: 항목 이름에 `white-space: nowrap`
  을 주면 표가 화면보다 넓어지고, 남은 폭에 밀린 값 칸이 한국어 글자 중간에서 끊긴다. `table-layout: fixed` +
  열 폭(44%/28%/28%) + `word-break: keep-all`·`overflow-wrap: anywhere`·`text-wrap: pretty` 로 어절 단위로만 접는다.
  가드=`tests/responsiveTextWrapContract.test.mjs`.
- ★**Worker 배포 자격(2026-08-02 갱신)**: 루트 `.env` 의 `CLOUDFLARE_API_TOKEN` 은 D1 전용이라 Workers 배포가
  `Authentication error 10000` 이다. 배포 권한 토큰과 계정 ID 는 **`worker/.env`** 에 있고 두 값 모두 따옴표를
  벗겨 프로세스 env 로 주입해야 한다(`"…"` 그대로면 `/accounts/"id"/…` 로 요청돼 실패).
  `worker/.env`·`worker/.dev.vars` 는 gitignore 이며 값을 출력·커밋하지 않는다.
  ★**Pages 배포도 같은 `worker/.env` 토큰을 쓴다(2026-08-17)**: `%APPDATA%/xdg.config/.wrangler` 의 OAuth 는
  만료돼 `wrangler pages deploy` 가 "Not logged in" 으로 끝난다(비대화형이라 `wrangler login` 불가).
  `worker/.env` 의 토큰에는 Pages 권한이 있으므로 **저장소 밖 디렉터리**에서 그 토큰을 주입해 실행한다
  (저장소 안에서는 루트 `.env` 의 D1 전용 토큰이 자동 로드돼 실패한다).
  ★**자격이 만료되면 `--env-file` 로 `.env` 자동 로드를 끈다(2026-08-26 실측)**: 이날 `worker/.env` 의 토큰이
  만료돼 `npm run deploy:worker` 가 `Authentication error 10000` 이었다. 반면 OAuth 자격
  (`C:UsersTK.wranglerconfigdefault.toml`, tkisdroid@gmail.com)은 살아 있고 `workers (write)` 와
  `pages (write)` 를 모두 갖는다. wrangler 4 는 `.env` 를 자동 로드해 OAuth 를 덮어쓰므로, **빈 파일을**
  **`--env-file` 로 넘겨** 그 자동 로드를 대체하면 저장소 안에서도 OAuth 로 배포된다
  (`cd worker && npx wrangler deploy --env-file <빈 파일>`). Pages 는 기존대로 저장소 밖 디렉터리에서
  `npx wrangler pages deploy <절대 dist 경로> --project-name=hyeni-calendar --branch=main --commit-dirty=true`.
  토큰 값은 출력·복사하지 않으며, 만료된 `worker/.env` 토큰 교체는 TK 몫이다.
  ★**배포 검증에서 entry 청크를 glob 으로 고르지 말 것(2026-08-26 실측)**: `dist/assets/index-*.js` 는 여러 개다
  (그날 진입 청크는 351,286바이트인데 `head -1` 이 집은 것은 413바이트짜리 다른 청크였다). 진입 청크는 반드시
  `dist/index.html` 이 실제로 참조하는 파일명으로 고른다 — 아니면 "로컬=프로덕션 일치"가 참인데도 엉뚱한
  파일을 대조하게 된다.
  ★**배포 전 migration 선행 확인(런북)**: `worker/db/*.sql` 이 만드는 테이블·인덱스·`ADD COLUMN` 을 프로덕션
  `sqlite_master`·`pragma_table_info` 와 대조한다. D1 은 `UNION ALL` 항 수 제한이 있어(5개 이상 실패) 테이블별로
  나눠 조회하고, `--json` 실패 응답은 `[` 로 시작하지 않으니 stderr 를 버리면 "컬럼 누락" 오진이 난다.

- 기기(2026-08-19 최신 사용자 지시): **A17(RFKL40DP73J)=부모 · razr(ZY22H9VTQD)=아이 ·
  S25(R5CY521CFNZ, SM-S937N)=역할 미고정** 상시 실기기 검증기 3대다. 세 기기 모두 현재 역할·세션을 유지하고
  `adb install --user 0 -r`로 앱 데이터·계정·페어링·세션을 보존한다. 실제 로그아웃·역할 전환·재페어링을 하지 않는다.
  S25 는 고정 역할이 없으므로 역할 의존 검증 전에 아래 CDP 세션 확인을 먼저 수행한다.
- 기기 역할은 세션별로 바뀐 이력이 있으므로, 문서의 과거 단계 기록보다 **최신 사용자 지시/goal**을 우선한다.
  실기기 검증 결과를 보고할 때는 CDP로 WebView 세션(`hyeni-api-session-v1`)의 role/familyId와 실제 화면을 다시 확인하고,
  지시한 역할과 다르면 해당 실기기 검증은 미검증/차단으로 분리 보고한다.
- adb(Git Bash): 원격 경로엔 `MSYS_NO_PATHCONV=1` · `keyevent 26` 은 토글(끄기 전 상태 확인) ·
  offline/unauthorized → `adb kill-server && adb start-server`.
- Windows cmd 함정: 실행 환경에 `NoDefaultCurrentDirectoryInExePath=1`이 있으면 cmd가 현재 디렉터리의
  `gradlew.bat`를 경로 접두어 없이 찾지 못한다("내부 또는 외부 명령이 아닙니다"). gradle 호출은 항상
  `.\gradlew.bat`처럼 경로를 명시한다(`tests/androidMergedManifestSecurity.test.mjs`도 동일).
- CDP: `adb forward tcp:922x localabstract:webview_devtools_remote_<pid>` → `http://localhost:922x/json` ·
  websocket 연결에 `suppress_origin` 필수 · **awaitPromise 긴 evaluate 는 hang** → 클릭/조회를 짧은 동기
  evaluate 로 쪼개고 결과는 별도 폴링 · `canvas.toBlob` 대신 `toDataURL`(동기) · React 제어 input 은
  native value setter + `input` 이벤트 · 페이지 fetch 로 `/rest/v1` 은 CORS 차단 → 토큰만 읽고 호스트 curl.
  최종 화면 판정은 `main` 같은 시맨틱 태그가 아니라 라우트별 실제 루트 선택자의 가시성으로 확인한다. `Log.enable`은
  이전 WebView 로그를 다시 전달할 수 있으므로 `Log.clear`와 수집 배열 초기화 후 새로고침한 응답만 현재 오류로 판정한다.
- D1: 컬럼 추측 금지 — `pragma_table_info` 먼저 · 시간 조건 검증은 백데이트 트리거
  (상태 시각을 과거로 UPDATE 후 이벤트 1회 주입) · `wrangler tail --format json` 을 파일로 받아 파싱.
  `/api/events`처럼 `events_children`를 다건 조회할 때는 D1 변수 제한을 넘지 않도록 `IN (...)` 바인딩을 청크 처리한다.
- 밤 시간대엔 force_ring/SOS 실발사 자제(실기기 벨 울림) — 발동 시 데이터 정리까지.

## 저장소

- 앱: https://github.com/tkisdroid/hyeni-3 (main) · 백엔드/레거시: https://github.com/tkisdroid/hyeni.
- 커밋 = conventional commits(`feat:`/`fix:`/`docs:`…) 한국어. `.env`(키)·빌드 산출물·180MB+ 에셋은 커밋 금지.

## Pages 지도 배포 재발 방지 (2026-09-20)

운영 웹을 배포하기 전에 최신 `origin/main`이 현재 소스에 포함됐는지 확인한다. 지도 기능이 없는 과거 작업 폴더에서 UI 파일 하나만 고쳐 배포하면 Google 지도·국가·시간대 기능 전체가 함께 빠진다.
`npm run deploy:pages`는 원격 main 선조 검사 → 새 build → `verify:pages-maps` → `.env` 없는 임시 폴더의 Wrangler 순서다. 로컬 build 성공만으로 배포 가능하다고 보지 않는다. 상세 증거는 [해외 지도 점검 보고서](../reports/2026-09-20-google-maps-audit.md)에 있다.
