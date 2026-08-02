# 혜니캘린더 Cloudflare 컷오버 기록 (M5.5 → 프로덕션, 실행 금지)

> **역사 기록 전용 — 2026-08-01 기준 실행 금지.** 이 문서는 2026-06-28~07-01의 Supabase→Cloudflare 전환 당시 상태를 보존할 뿐 현재 운영 런북이 아니다. B2, Supabase freeze, `crons=[]`, cron 복원 절차를 다시 실행하지 않는다.
> 현재 Worker·D1·cron·secret의 정본은 `README.md`, `wrangler.toml`, `ops/web-billing-refund-runbook.md`, 그리고 `C:\Users\TK\Desktop\hyeni-3\docs\store\play-release-checklist.md`의 2026-08-01 migration manifest다. 현재 `wrangler.toml [triggers]`의 활성 5개 cron을 임의로 비우거나 과거 8개 배열로 교체하지 않는다.
> iPhone 홈 화면 PWA Web Push를 출시 범위에 포함하면 `VAPID_PUBLIC_KEY`와 `VAPID_PRIVATE_KEY`는 선택 설정이 아니라 필수 출시 게이트다.

> 생성 2026-06-28. 대상 Worker: `hyeni-calendar-api.tkisdroid.workers.dev`
> 현재 prod 배포: `12bf8cfc-4a46-4b8e-82de-f1a17958cf83` (2026-06-30T20:29:34Z 생성, KST 2026-07-01 확인).
> 당시 진행: A1~A5, B0, B1 코드/빌드 검증 완료. B2 원자 플립은 수행하지 않았고 현재는 대체된 절차다.
> 2026-07-01 preflight: remote D1 additive schema/index 적용, Worker deploy, 실기기 CDP smoke 완료. `bundleRelease`는 PASS했지만 `app-release.aab`는 unsigned라 Play upload signing이 남아 있다.
> Supabase freeze 금지 상태: 현재 CLI 계정에서 운영 ref `qzrrscryacxhprnrtpjd`가 보이지 않고, Management API는 403, 저장 DB password는 auth 실패.
> 당시 재점검 조건: `node scripts/release-cutover-preflight.mjs`와 `node scripts/supabase-cron-cutover-plan.mjs`. 현재 운영 절차로 실행하지 않는다.

## 원칙 (split-brain 회피)
- 당시 **3-A** 까지는 클라/네이티브가 **Supabase**를 권위 백엔드로 봤다.
- 당시 **3-B B2**는 Supabase freeze와 cron 복원을 묶은 비가역 플립 계획이었다. 현재는 실행하지 않는다.
- 당시 모든 명령은 `worker/` 디렉토리에서 실행했다. 현재 작업은 최신 운영 정본을 따르며 Cloudflare 자격정보 값을 문서나 명령 인자에 기록하지 않는다.

## 사전 조사 결과 (2026-06-28 Claude 조회)
| 항목 | prod 현재 |
|------|-----------|
| 배포 버전 | `c6d795a8` (M5), DO migration **v1만** |
| D1 `phone_otp` | ❌ 없음 |
| D1 `family_review_rewards` | ❌ 없음 |
| D1 핵심(families/events/fcm_tokens/location_history/child_locations/family_subscription) | ✅ 있음 |
| R2 `child-photos` | ❌ 없음 (`topik-materials`만) |
| Secret ✅ | JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY_B64, PUSH_INTERNAL_SECRET |
| Secret ❌ | OPENAI/ANTHROPIC/NCP_SENS*/QONVERSION*/GOOGLE_PLAY*/KAKAO*/GOOGLE_OAUTH*/NAVER*/RESEND/VAPID* |

---

# 3-A. prod Worker 최신화 (안전 — 클라 Supabase 유지)

## A1. D1 스키마 적재
```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --file=db/phone-otp-schema.sql
npx wrangler d1 execute hyeni-calendar --remote --file=db/review-rewards-schema.sql
```
**검증**:
```bash
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('phone_otp','family_review_rewards') ORDER BY name"
```
→ `family_review_rewards`, `phone_otp` 2행이면 OK.

## A2. R2 버킷 생성
```bash
npx wrangler r2 bucket create child-photos
npx wrangler r2 bucket list   # 검증: child-photos 포함
```

## A3. Secrets 추가
값은 **기존 Supabase Edge Function secrets / 외부 콘솔**에서 확보. 각 명령 실행 후 값 붙여넣기:
```bash
npx wrangler secret put <NAME>
```

| Secret | 기능 | 컷오버 필수도 | 값 출처 |
|--------|------|--------------|---------|
| `NCP_SENS_ACCESS_KEY` / `NCP_SENS_SECRET_KEY` / `NCP_SENS_SERVICE_ID` / `NCP_SENS_FROM_NUMBER` | SMS·전화가입·OTP | **필수**(신규가입/OTP) | Supabase EF / NCP 콘솔 |
| `OPENAI_API_KEY` | AI 채팅·일정파싱 | AI 쓰면 필수 | Supabase EF |
| `ANTHROPIC_API_KEY` | AI 채팅 | AI 쓰면 | Supabase EF |
| `KAKAO_REST_API_KEY` **및** `KAKAO_REST_KEY` (같은 값) | 도보 길찾기 + 카카오 로그인 | 길찾기/카카오로그인 | Kakao 콘솔 |
| `KAKAO_CLIENT_SECRET` | 카카오 OAuth(콘솔 "보안" 활성 시만) | 선택 | Kakao 콘솔 |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | 구글 로그인 | 구글로그인 | Google Cloud |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 로그인 | 네이버로그인 | Naver 콘솔 |
| `QONVERSION_API_KEY` (+ `QONVERSION_WEBHOOK_SECRET` 등 옵션) | 구독 검증/웹훅 | 결제 쓰면 | Supabase EF / Qonversion |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` / `GOOGLE_PLAY_PACKAGE_NAME` | Play 결제 검증 | 결제 | Google Cloud |
| `RESEND_API_KEY` / `FEEDBACK_FROM_EMAIL` / `FEEDBACK_TO_EMAIL` | 피드백 메일 | 선택 | Resend |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 웹푸시(네이티브 FCM과 별개) | 당시 선택으로 기록했으나 iPhone PWA Web Push 출시에는 필수 | 기존/생성 |

> 역사적 판단이다. 현재 출시 기능의 필수 secret은 최신 README와 출시 체크리스트를 따른다. 특히 VAPID 미설정은 iPhone PWA Web Push 출시 차단이다.
**검증**: `npx wrangler secret list`

## A4. 배포 (M5.5 코드 + DO migration v2=TeacherRoom)
당시에는 `wrangler.toml`의 `crons = []` 유지를 요구했다. 현재 설정과 충돌하므로 실행하지 않는다.
```bash
npx wrangler deploy
```
**검증**: `npx wrangler deployments list` → 최신 버전이 방금 배포분.
DO migration v2 가 자동 적용(TeacherRoom 클래스 추가, v1 비파괴).

## A5. prod E2E 스모크 (read-only — Claude 가 수행 가능)
JWT 로 parent 토큰 발급 후 events/saved-places 200, invalid 401, cross-family 403, rest-shim 검증.
(1차 배포 때 패턴 — Claude 가 스크립트 준비/실행)

---

# 3-B. 과거 컷오버 절차 (이미 대체됨 — 재실행 금지)

> 아래는 당시 설계 기록이다. 현재 환경에서 어떤 단계도 실행하지 않는다.

## B0. 사전 (비파괴)
- **OAuth 콜백URL 콘솔 등록**: kakao/google/naver →
  `https://hyeni-calendar-api.tkisdroid.workers.dev/api/auth/oauth/{provider}/callback`
- **기존 사진 이관**: Supabase Storage `child-photos` → R2 `child-photos` 복사(유실 방지, 별도 스크립트).

## B1. 클라/네이티브 빌드
- `.env`: `VITE_API_BASE=https://hyeni-calendar-api.tkisdroid.workers.dev`
  (⚠️ 개발머신 `.env.local` 은 로컬 `127.0.0.1:8787` override 중 → prod 빌드 시 충돌 주의)
- 네이티브 `supabaseUrl` → Worker URL 분기 확인(P0-c 에서 isApiEnabled 분기 이식됨).
- `npm run build && npx cap sync android` → Android Studio 에서 AAB 빌드.
- 2026-07-01 CLI 확인: `android/gradlew.bat bundleRelease` PASS, `android/app/build/outputs/bundle/release/app-release.aab` 생성. 단 `jarsigner -verify` 결과 unsigned. Play 업로드 전 `HYENI_KEYSTORE*` Gradle property 또는 OS 환경변수를 주입한 signed AAB 필요.

## B2. 당시 원자 플립 기록 (현재 실행 금지)
1. **Supabase `pg_cron` freeze** (대시보드 SQL: 활성 잡 `cron.unschedule`) — 중복 실행 차단.
2. `worker/wrangler.toml` `crons` 복원:
   `["* * * * *", "*/2 * * * *", "1-59/2 * * * *", "*/4 * * * *", "*/3 * * * *", "*/5 * * * *", "*/10 * * * *", "0 * * * *"]`
   (`worker/index.ts` `scheduled()` 의 표현식과 일치).
3. `npx wrangler deploy` (cron 활성화).
> freeze **먼저** → cron 복원. 역순이면 양쪽 cron 동시 실행(중복 알림).

## B3. 스토어 배포
- AAB Play Console 업로드 → 심사 → 출시(또는 force-upgrade 게이트로 구버전 차단).

## B4. 컷오버 검증
- 실기기 신규 설치 → 전화 로그인 → 일정/위치/AI/알림/페어링 종단.
- prod E2E 2회 연속.

## B5. 정리
- 당시 노출 가능 자격정보는 각 제공자 콘솔에서 폐기 여부를 확인한다. 토큰 값·접두사·DB 비밀번호는 문서에 기록하지 않는다.

---

## 진행 체크리스트
- [x] A1 D1 스키마 적재 (phone_otp, family_review_rewards — 2026-06-29, num_tables 62→64)
- [x] A2 R2 버킷 (child-photos — A4 배포 시 wrangler.toml 바인딩으로 자동 프로비저닝)
- [x] A3 Secrets (2026-06-29 — 출시범위: NCP_SENS×4·GOOGLE_OAUTH×2·KAKAO×2·OPENAI·FCM×3·JWT×2·PUSH = 14종. 제외: NAVER/QONVERSION/GOOGLE_PLAY)
- [x] A4 배포(M5.5+v2) (Version `bd79c41d`, TeacherRoom DO v2 적용)
- [x] A5 prod E2E 스모크 (request-otp 게이트·google/kakao start 302·secret 14종 검증)
- [x] B0 OAuth 콜백(구글·카카오 authorize 통과 검증) + 사진 이관(16/16 R2, 다운로드 크기 일치 검증)
- [x] B1 클라/네이티브 빌드 검증 (`.env.local` VITE_API_BASE=Worker, build OK, 번들 Worker URL 확인, localhost 오염 없음, cap sync OK, `bundleRelease` PASS) — ⬜ 남은 것: signed AAB
- [ ] B2 당시 원자 플립 기록 — 현재는 재실행하지 않으며 `wrangler.toml [triggers]`의 활성 5개 cron을 유지
- [ ] B3 스토어
- [ ] B4 컷오버 검증
- [ ] B5 당시 자격정보 폐기 기록 — 토큰 값·접두사·DB 비밀번호를 문서에 남기지 않고 각 제공자 콘솔에서 폐기 여부를 확인
