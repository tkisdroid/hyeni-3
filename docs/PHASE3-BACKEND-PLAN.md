# 3단계 백엔드 연동 계획 (hyeni-3)

> 백엔드 = hyeni-1의 Cloudflare Worker 재사용(재구축 금지).
> API base: `https://hyeni-calendar-api.tkisdroid.workers.dev`
> 이 문서는 3단계 진행 중 **살아있는 트래커**입니다. 슬라이스 완료 시 상태표를 갱신하세요.

---

## 0. 확정 결정 (사용자 승인 · 2026-07-04)

| # | 결정 | 내용 |
|---|---|---|
| D1 | **실시간 WS 우선** | Durable Objects 가족소켓(WebSocket)을 **Slice 3(가족)부터 도입**. REST 폴백 아님. |
| D2 | **실제 Kakao 지도** | ParentLocation/RouteView에 Kakao Maps JS SDK 도입. 키(`VITE_KAKAO_APP_KEY`)는 hyeni-1에서 재사용(`.env.local`, 값 커밋 금지). |
| D3 | **소셜 로그인(네이버 제외)** | 카카오·구글 OAuth + ID/PW + 전화가입 + 아이 페어링. **네이버는 디자인에서 완전 제외**(2026-07-04 재확정 — LoginStep에 원래 없음). |
| D4 | **네이티브 defer** | 결제(Google Play Billing)·원격청취(RemoteAudio)·친구놀이(FriendPlay/PlaydateAccept)는 **4단계(Capacitor)로 이월**. 3단계는 조회/표시만, 결제 CTA는 토스트 유지. |

### 미결정/블로커
- **네이버 Client ID 없음**: hyeni-1 어디에도 `VITE_NAVER_CLIENT_ID` 미설정 → 네이버 버튼은 "설정 필요" 상태로 두고 나머지 전부 활성화. **키 주시면 즉시 연결.**
- 카카오/구글 OAuth 로그인은 Worker 서버 시크릿 경유 → 클라 키 불필요.
- 알림설정 저장 엔드포인트 부재(ParentSettings 토글 5종) → 서버 스키마 확인 전까지 로컬 state.
- 스티커 집계 정본 소스 불명확(StickerBook/ChildHome) → 확정 전 목업 유지.

---

## 1. 아키텍처 (신규 3계층)

```
컴포넌트  →  queries/*(TanStack Query 훅)  →  lib/api/endpoints/*(fetch 래퍼)  →  lib/api/client.ts  →  Worker
                                                          ↑ realtime/familySocket.ts(WS) → queryClient.invalidate
```

- **컴포넌트는 `queries/*` 훅만 import.** endpoints/*는 훅 내부에서만 호출(LS·Query 캐시 이중화 방지).
- 화면은 목업 import를 `useXxx()` 훅으로 1:1 교체. 목업의 표현 데이터(아이콘·색)는 뷰모델 매퍼로 유지, 도메인 데이터만 실 API로.

### 폴더 구조
```
src/
  config/env.ts                  ✅ API_BASE/KAKAO/NAVER 파생·검증
  lib/api/
    client.ts                    ✅ apiGet/Post/Put/Patch/Delete, 401 회전, 204 단락, 스토리지 프록시
    session.ts                   ✅ 세션 영속(localStorage), JWT claim 디코드
    errors.ts                    ✅ ApiError, isUnauthorized/isMissingFunction
    endpoints/auth.ts            ✅ login-password/anonymous/check-id/signup/delete + OAuth(카카오·구글 start/finish/callback)
    endpoints/family.ts          ✅ mine/setup/join/join-as-parent/profile/pair-code + parentNameFromUser
    endpoints/{schedule,location,memo,subscription,teacher,ai}.ts   ⬜
  realtime/{familySocket,teacherSocket,routePgChange}.ts   ⬜
  transform/phone.ts             ✅ 전화/ID/성별/생일 정규화 + 가입폼 검증
  transform/pairCode.ts          ✅ KID 코드 정규화
  transform/{dateKey,entitlement,childrenContext,...}.ts   ⬜
  queries/
    keys.ts                      ✅ queryKey 팩토리
    QueryProvider.tsx            ✅ QueryClient(4xx 재시도금지·포그라운드 재조회) + 싱글턴
    use{Family,Schedule,Location,Memo,Entitlement,Teacher,Ai,FamilyRealtime}.ts   ⬜
  auth/{AuthContext,AuthProvider,guards,RequireAuth,RequireRole}.tsx   ✅ (가드 라우터 미삽입)
```

---

## 2. 슬라이스 트래커

각 슬라이스 완료기준 = `npm run build` exit 0 + 지정 검증.

| # | 슬라이스 | 상태 | 완료기준 |
|---|---|---|---|
| 0 | 인프라(client.ts·Query·env) | ✅ 완료 | build/typecheck exit 0, dev 부팅 200, 목업 렌더 유지 |
| 1 | 인증 코어(AuthContext·가드·세션복원) | ✅ 완료 | build exit 0 + JWT 디코드·가드 판정 assert 통과 |
| 2 | 온보딩 배선(카카오·구글·ID/PW·전화OTP·페어링) | ✅ 완료 | **브라우저+라이브 Worker E2E**: 미인증→온보딩 가드, 아이 익명로그인 실세션 발급→KID 페어링, role 라우팅 전부 통과. build/typecheck exit 0 |
| 3 | 가족 도메인 + 가족소켓(WS 도입) | ✅ 완료 | **실데이터 E2E**: ParentFamily(멤버·"나"뱃지), ChildInvite(실 pairCode·만료), PhoneSetup(보호자·본인만 편집). **familySocket WS 라이브 `/realtime` 연결 OPEN 검증**. `queries/{useFamily,useFamilyRealtime}`+`realtime/familySocket`+`transform/familyView`+App RealtimeBridge. ⚠️ ProfileEdit=아이편집 엔드포인트 없음→보류. 쓰기 뮤테이션(저장·재발급)은 배선+빌드만(계정 쓰기라 미실행) |
| 4 | 일정 도메인 | ✅ | **ParentCalendar+ParentHome+ChildHome 실 events E2E**(date_key 0-index 검증). 아이 세션(익명→페어링) 생성해 ChildHome "테스트아이"·실 시간표 검증. 일정 생성 UI=후속 |
| 5 | 위치 + Kakao 지도 SDK | ✅ 대부분 | **ParentLocation 실 Kakao 지도 E2E**(자녀 마커·위험구역 원·저장장소·신선도, D2 달성). PlaceManager 실 8장소. PlaceForm/RouteView/ChildSos=후속(쓰기·도보경로) |
| 6 | 메모 실시간 | ✅ | MemoChat 실 스레드(빈계정 정상) + WS `memo_replies` 브릿지. 전송 배선(미실행). 스티커·읽음=후속 |
| 7 | 구독/엔타이틀먼트(조회만) | ✅ E2E | Subscription/ParentSettings 실 티어("프리미엄 연구독·2100년까지"). **R9(무료강등 금지) 준수**. 결제 CTA defer |
| 8 | AI 도메인 | ✅ | AiCredit(크레딧/충전팩)·AiFriendChat 배선. 전송/구매 defer(쓰기·크레딧) |
| 9 | 선생님 도메인 | ✅ 빌드 | endpoints/queries/화면 배선 + isMissingFunction 폴백. **아이/선생님 계정 필요**(부모계정 E2E 불가) |
| 10 | 실시간 invalidation 브릿지(횡단) | ✅ | `useFamilyRealtime`이 family/events/memo/location/alerts/entitlement table→queryKey invalidate. WS `/realtime` OPEN 검증. RealtimeBridge 전역 마운트 |

### 검증 요약 (2026-07-04, 라이브 Worker + 브라우저 E2E)
전 도메인 실데이터 렌더 확인: 가족·일정(캘린더/홈)·위치(Kakao 지도)·구독·알림·메모·AI. 통합 빌드 exit 0. 발견·수정 버그: 레거시세션 오염, 가드 null-role 허점, ApiUser 최상위 role/family_id, date_key 0-index, placeLabel 인자.

### 검증 중 생성한 테스트 데이터(정리 필요 시)
- 페어코드 재발급: KID-D1249271(만료) → **KID-F884BC83**.
- 가족에 테스트 아이 **"테스트아이"** 추가됨(익명→페어링). 불필요 시 부모가 unpair 가능. 검증 중 익명 유저 몇 건(가족無) 생성.

### 보조 화면(2차 워크플로우, 통합 빌드 exit 0)
- **RouteView** ✅ E2E: 실 Kakao 도보경로(집→방과후영어, 306m 폴리라인). `endpoints/route`+`useRoute`.
- **PlaceForm** ✅: Kakao 지도 피커(클릭 좌표선택+역지오코딩)+주소검색. 저장=버튼 배선(defer).
- **StickerBook·StickerSend·ChildHome 스티커카운트** ✅ 배선: `endpoints/stickers`+`useStickers`(summary/received/send). 새 아이라 빈상태. 전송=버튼 배선.
- **ChildSos** ✅ 배선: `endpoints/sos`+`useSos`(위치→alert→sos/events). SOS 발송=사용자 홀드/버튼만(자동 실행 금지).
- **AiSchedule** ✅ 배선: 텍스트→AI파싱→일정생성(버튼 배선, defer).
- **메모 쓰기** ✅ E2E 검증: POST/GET round-trip(reply 생성→스레드 표시, KST 시간).

### 남은 후속(정직한 목록)
- **아이 세션 필요 추가 E2E**: 아이 메모 UI 전송(직접 API는 검증됨), ChildSos 실발송(고위험·미실행), StickerSend 실전송.
- **선생님 계정 필요 E2E**: TeacherHome/Students.
- **쓰기 뮤테이션 실행**: 전부 배선+빌드 완료, 계정 데이터 변경이라 미실행(일정생성·프로필저장·코드재발급·메모전송·읽음·장소CRUD·위험구역).
- **엔드포인트 미확정**: ProfileEdit(아이편집), 기기 안전지표/최근앱(screenTime·battery), 알림설정 저장, 스티커 집계.
- **4단계(Capacitor) defer**: 결제, RemoteAudio, FriendPlay/PlaydateAccept, RouteView(도보경로), SOS 네이티브 발송.
- **PlaceForm/RouteView**: 지도 선택·도보경로 UI 후속.

**Slice 2 검증 노트**:
- ✅ E2E 검증(브라우저): 가드, 아이 익명로그인(라이브 세션), role 라우팅.
- ⏳ 배선완료·풀 E2E 대기(외부 의존): 카카오/구글 OAuth 콜백(provider redirect_uri가 배포 origin 등록 필요 — localhost 복귀는 provider 설정에 따라 다름), ID/PW 실로그인(테스트 계정 필요), 전화 가입 OTP(실 SMS 필요), 가족 setup/join(로그인 세션 필요). 모두 build 통과 + 엔드포인트 계약 확인됨.
- 🐛 발견·수정: (1) 레거시 Supabase 세션 마이그레이션 제거(신규 앱이 외부 stale 토큰 채택하는 문제), (2) `RequireRole`이 role 미확정(null) 인증 사용자를 통과시키던 허점 → 온보딩으로 바운스하도록 수정.
- ℹ️ 검증 중 라이브 Worker에 익명 유저 2건(throwaway, 가족 없음) 생성됨.

---

## 3. 화면 ↔ 엔드포인트 매핑 (핵심)

**모든 경로는 hyeni-1 코드에서 실재 확인됨.**

- **인증**: `/auth/{anonymous,login-password,check-login-id,signup/request-otp,signup/verify,refresh}`, `/api/auth/oauth/:provider/{start,콜백}`, `/api/auth/naver`, `/api/auth/oauth-bridge/*`, `/api/account/merge-oauth`
- **가족**: `GET /api/family/mine`, `POST /api/family/{setup,join,join-as-parent,unpair}`, `POST /api/family/pair-code/regenerate`, `PATCH /api/family/profile`, `POST /api/account/delete`
- **일정**: `GET/POST /api/events`(+`/simple`), `PATCH/DELETE /api/events/{id}`, `/api/academies`, `GET/PUT /api/daily-supplies`
- **위치**: `GET /api/location/{children,history,incidents}`, `GET/POST/DELETE /api/danger-zones`, `/api/saved-places`, `POST /api/parent-alerts`, `POST /rest/v1/rpc/{upsert_child_location,record_location_history_rows}`
- **메모**: `GET/POST /api/memos/replies`, `POST /api/memos/replies/{id}/read`
- **구독**: `GET /api/entitlement`, `GET /api/subscriptions`, `POST /api/billing/google-play-verify`(defer)
- **선생님**: `GET /api/teacher/{me,classes,parent-links,...}`, `GET /api/teacher/classes/{id}/{roster,attendance,schedule}`, `POST /api/teacher/{profile,classes,notices,attendance,pairings/request}`
- **AI**: `/api/ai/{child-chat,messages,settings,credits/*,voice-parse}`, `/api/playdate/*`(defer)

---

## 4. 기술 함정 (코드리뷰 게이트)

- **date_key 0-index 월**: `"YYYY-M-D"` 월이 0-indexed·비패딩. `transform/dateKey.ts` 경유 강제, 직접 문자열 조립 금지.
- **entitlement 실패 강등 금지**: 네트워크/5xx 시 free로 강등하면 결제 유저가 캐시에 박힘 → 실패=캐시 유지, 없으면 ready=false.
- **로그아웃 캐시 clear**: logout/anonymous/deleteAccount 시 `queryClient.clear()` + family/entitlement/childPhoto 캐시 clear 필수.
- **세션 재발급 API**: join/join-as-parent/verify는 `applyApiSession(토큰)+setApiUser(user)` 둘 다 호출 후 AuthContext 반영(특히 joinFamily = 익명→child 플립).
- **member.id vs user_id**: unpair·profile은 구분 주의.
- **SOS 발송 순서**: 위치→alert→push→audit, fire-and-forget·멱등.
