# AGENTS.md — 혜니캘린더 리디자인 (hyeni-3)

> 모든 AI 코딩 에이전트(Claude, Codex, Cursor, Gemini 등) 공통 작업 지침.
> **상세 이력·단계별 기록의 정본은 `CLAUDE.md`** — 반드시 먼저 읽고 이어서 작업할 것.
> 이 문서는 CLAUDE.md 를 자동 로드하지 않는 도구를 위해 핵심을 자립형으로 요약한다.

## 프로젝트 한 줄

혜니캘린더 = 가족 일정 공유 + 부모·자녀 위치/안전 앱. **웹앱(PWA) 단일 코드베이스 +
Android 만 Capacitor 래핑**. 백엔드는 **hyeni-1 의 Cloudflare Worker 를 그대로 재사용(재구축 금지)**.
1~10단계 전부 완료 — 현 국면은 **실사용 안정화**(TK 가 실기기 3대로 쓰며 제보 → 즉시 수정·검증·배포).

## 언어·말투 (절대 규칙)

- 모든 응답·주석·커밋 메시지 = **한국어**. 기술 용어·코드 식별자는 원문.
- 앱 문구: **부모·페어링·구독 = 존댓말 / 아이 모드 = 반말**.

## 스택·명령

Vite 7 · React 19 · TypeScript(strict) · 플레인 CSS(디자인 토큰) · React Router v7(**HashRouter**) ·
TanStack Query · lucide-react · Capacitor 8(Android).

```bash
npm run dev        # http://localhost:5173
npm run typecheck  # tsc -b  (수정 후 필수)
npm run build      # 완료 기준 = exit 0
# Android: npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
# 설치:    adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
# 웹 배포: npx wrangler pages deploy dist --project-name=hyeni-calendar --branch=main --commit-dirty=true
# Worker(백엔드, C:\Users\TK\Desktop\hyeni-1\worker): npx tsc --noEmit && npx wrangler deploy
```

API base: `https://hyeni-calendar-api.tkisdroid.workers.dev` · 배포 웹: https://hyeni-calendar.pages.dev

## 절대 안전 규칙

1. **실사용 기기 무접촉**: razr(모토로라)=혜니 실사용 기기 — adb·세션·페어링 등 어떤 조작도 금지.
   테스트는 A17(아이 "테스티")·S25(부모)로만.
2. **라이브 refresh 토큰 조작 금지** — 회전시키면 앱 세션이 파괴된다. access 토큰만 읽기.
3. **파괴적 작업 전 안전 불변식 확인**(예: 아이 페어링 전 프리미엄 캡 확인 — 기존 아이가 밀리지 않는지).
4. 테스트로 만든 데이터·바꾼 설정은 **반드시 원복/삭제**. 비밀번호는 사용자만 입력.
5. 프로덕션 D1 파괴적 삭제·스토어 배포·시크릿 변경 금지.

## 아키텍처 핵심 (어기면 다자녀에서 데이터가 섞인다)

- **전역 활성 아이 스위치**: `src/app/activeChild.tsx` `useActiveChild()`. 아이 전환 UI 는 **부모 홈에만**.
  다른 화면 우선순위 = 딥링크(`?child=<user_id>`·`state.childUserId/childId`) > `activeChild` >
  **첫째(children[0]) 폴백 금지**. 명시적 수신자 선택 화면(EventForm 배정·StickerSend·RemoteRing)만
  자체 선택 허용하되 기본값=활성 아이.
- **식별자 2축**: events/supplies/memo 귀속 = `family_members.id`(member id) /
  location/device/parent_alerts/remote-listen = auth `user_id`. `DailySupply.child_user_id` 는
  이름과 달리 member id — 이름만 보고 판단 금지, 저장값 기준.
- **date_key 함정**: 월이 **0-indexed 비패딩**("2026-6-5" = 7월 5일). 반드시 `src/transform/dateKey.ts` 경유.
- **메모 = 아이별 1:1 스레드**: fetch/send 에 childId(member id) 필수, `qk.memoReplies` 키에 childId 포함.
  리치 메시지 = content 마커 `[[img:R2key]]` / `[[loc:lat,lng|주소]]` (`src/transform/memoView.ts`).
- **알림**: 일정 리마인더는 전부 서버 cron(사용자별 `notification_settings.minutes_before` 정확 매칭,
  클라 로컬 스케줄러 없음) · 긴급(sos/emergency)은 `POST /api/parent-alerts` insert 시 서버가 FCM
  전체화면 연쇄 · 기기 상태(device_health)는 **on-demand**(부모가 `request_device_status` 푸시를 보내야 옴) ·
  미등록 장소 도착 = `worker/lib/arrivalDetect.ts`(150m·5분 체류·2h 쿨다운).
- **도보 길찾기**: Kakao affiliate 403 → 서버(`worker/routes/kakao.ts`)가 OSRM foot 으로 폴백해
  Kakao 응답 형태로 합성(클라 무변경). 트래픽 증가 시 제휴/자체 호스팅 필요.

## 코딩 컨벤션

- hex 직접 금지 → `src/styles/tokens.css` CSS 변수. 신호색 고정(민트=안전, 앰버=주의, 레드=위험/SOS, 파랑=정보).
- 공통: `.hy-card .hy-press .hy-chip .hy-topbar .hy-content` · `TopBar`/`SectionHeader` · `asset("경로")` · lucide 아이콘.
- 화면 패턴 정답 = `src/screens/parent/ParentHome.tsx`. 탭 화면=각 Shell 하위, 상세=PushShell(뒤로가기 `navigate(-1)`).
- strict TS: `import type`, 미사용 금지, `<button type="button">`, 상태는 불변 업데이트(spread).
- LLM 호출·크레딧 소모·원격 제어(force_ring 등)는 **사용자 버튼 onClick 에서만**(자동 실행 금지).

## 작업 원칙 (실증된 사고방식 — CLAUDE.md §0.5 와 동일)

1. **증거 없으면 완료 아님**: 실기기 E2E(adb+CDP) + 서버(D1) 크로스체크 후에만 완료 선언.
   미검증 항목은 보고에서 분리해 정직 고지. 에이전트 보고도 코드 재확인 후에만 반영.
2. **제보는 재현부터**: 코드 추측 수정 금지 — 실기기/실데이터로 증상 재현해 진짜 원인 특정.
3. **근본 원인 + 다중 방어**: 레이스·유실 계열은 서버+클라 양쪽에 방어를 겹친다.
4. **정직한 강등**: 외부 의존 실패 시 가짜 데이터 금지 — 명시적 폴백("직선 553m 쯤"+외부 앱 버튼 등).
5. **재사용 우선**: hyeni-1 서버/인프라 먼저 조사, 서버 무변경 해법 선호.
6. **오케스트레이션**: 넓은 탐색·감사=병렬 에이전트+적대 검증(CONFIRMED 만 수정) /
   정밀 수정·아키텍처=단일 컨텍스트 인라인.
7. **보고**: 결론 먼저 한 줄 → 검증 표 → 리스크·미해결·사용자 몫 정직 고지. "될 것입니다" 금지,
   "○○ 실기기 확인" 같은 관측 사실만.

## 실기기 검증 치트시트

- 기기: S25(R5CY521CFNZ)=부모 · A17(RFKL40DP73J)=아이 테스트 "테스티" · razr(ZY22H9VTQD)=**무접촉**.
- adb(Git Bash): 원격 경로엔 `MSYS_NO_PATHCONV=1` · `keyevent 26` 은 토글(끄기 전 상태 확인) ·
  offline/unauthorized → `adb kill-server && adb start-server`.
- CDP: `adb forward tcp:922x localabstract:webview_devtools_remote_<pid>` → `http://localhost:922x/json` ·
  websocket 연결에 `suppress_origin` 필수 · **awaitPromise 긴 evaluate 는 hang** → 클릭/조회를 짧은 동기
  evaluate 로 쪼개고 결과는 별도 폴링 · `canvas.toBlob` 대신 `toDataURL`(동기) · React 제어 input 은
  native value setter + `input` 이벤트 · 페이지 fetch 로 `/rest/v1` 은 CORS 차단 → 토큰만 읽고 호스트 curl.
- D1: 컬럼 추측 금지 — `pragma_table_info` 먼저 · 시간 조건 검증은 백데이트 트리거
  (상태 시각을 과거로 UPDATE 후 이벤트 1회 주입) · `wrangler tail --format json` 을 파일로 받아 파싱.
- 밤 시간대엔 force_ring/SOS 실발사 자제(실기기 벨 울림) — 발동 시 데이터 정리까지.

## 저장소

- 앱: https://github.com/tkisdroid/hyeni-3 (main) · 백엔드/레거시: https://github.com/tkisdroid/hyeni.
- 커밋 = conventional commits(`feat:`/`fix:`/`docs:`…) 한국어. `.env`(키)·빌드 산출물·180MB+ 에셋은 커밋 금지.
