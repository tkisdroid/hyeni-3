# 카카오 소셜 로그인 준비 상태 (2026-07-10)

## 결론

**코드·서버·앱 배선은 전부 완료돼 있습니다.** 남은 건 카카오 개발자 콘솔 설정 확인 한 번과
실기기 로그인 1회 검증뿐입니다.

| 구성요소 | 상태 | 근거 |
|---|---|---|
| Worker 라우트 `/api/auth/oauth/kakao/start`·`/callback`·`POST` | ✅ 라이브 동작 | 302 → `kauth.kakao.com` 확인 |
| Worker secret `KAKAO_REST_API_KEY` | ✅ 등록됨 | `wrangler secret list` |
| `KAKAO_CLIENT_SECRET` | ⚪ 미등록 (콘솔에서 "사용 안 함"이면 정상) | 코드는 있으면 자동 사용 |
| 클라 온보딩 "카카오로 계속하기" 버튼 | ✅ 있음 | `Onboarding.tsx:601` |
| 네이티브 딥링크 `hyenicalendar://auth-callback` | ✅ 매니페스트 등록 | `AndroidManifest.xml:101` |
| 이메일 미제공 시 폴백 | ✅ `kakao-{id}@hyeni.local` | `oauth.ts:298` |
| 카카오 계정 ↔ tkisdroid 연결 | ✅ `auth_identities` 존재 | provider_id `4793460650` |

### 라이브 확인된 인가 요청 (2026-07-10 배포본)
```
https://kauth.kakao.com/oauth/authorize
  ?response_type=code
  &client_id=d502354032…
  &redirect_uri=https://hyeni-calendar-api.tkisdroid.workers.dev/api/auth/oauth/kakao/callback
  &scope=profile_nickname account_email profile_image
  &state=<base64({nonce,target})>
```

---

## 1. 카카오 개발자 콘솔에서 확인할 것 (TK)

https://developers.kakao.com/console/app → 해당 앱

### 1-1. 카카오 로그인 → **Redirect URI** (가장 중요)
아래 값이 **정확히** 등록돼 있어야 합니다(앱/웹 주소가 아니라 **Worker 주소**):
```
https://hyeni-calendar-api.tkisdroid.workers.dev/api/auth/oauth/kakao/callback
```
> 불일치하면 `KOE320`으로 실패합니다.

### 1-2. 카카오 로그인 → 활성화 설정: **ON**

### 1-3. 동의항목 (코드가 요청하는 scope와 반드시 일치)
| scope | 콘솔 동의항목 | 필요 |
|---|---|---|
| `profile_nickname` | 닉네임 | 필수 |
| `profile_image` | 프로필 사진 | 선택 |
| `account_email` | 카카오계정(이메일) | **비즈니스 앱 전환/검수 필요할 수 있음** |

> ⚠️ 콘솔에 없는 scope를 요청하면 `KOE205`(존재하지 않는 동의항목)로 실패합니다.
> **이메일 동의를 받을 수 없다면** 아래처럼 scope에서 빼면 됩니다. 서버가 자동으로
> `kakao-{id}@hyeni.local` 폴백 이메일을 만들기 때문에 로그인·계정 식별에 문제 없습니다.
> ```bash
> cd C:\Users\TK\Desktop\hyeni-1\worker
> npx wrangler secret put KAKAO_OAUTH_SCOPE
> # 입력: profile_nickname profile_image
> ```
> (미설정이면 기본 `profile_nickname account_email profile_image` 사용 — 코드 배포 불필요)

### 1-4. 보안 → **Client Secret**
- "사용 안 함"이면 그대로 두시면 됩니다(현재 Worker에 미등록 = 일치).
- "사용함"으로 켜져 있다면 반드시 Worker에 등록해야 합니다. 안 하면 `KOE010`:
```bash
npx wrangler secret put KAKAO_CLIENT_SECRET
```

### 1-5. 플랫폼 등록은 **불필요**
Android 플랫폼(패키지명·키 해시) 등록은 **카카오 SDK를 쓸 때만** 필요합니다.
이 앱은 SDK 없이 **시스템 브라우저 → Worker 콜백 → 딥링크 복귀** 방식이라 Redirect URI만 있으면 됩니다.

---

## 2. 안전한 실기기 검증 절차

카카오 로그인 완료에는 비밀번호 입력이 필요하므로 TK가 직접 하셔야 합니다.

**S25(부모 기기)에서 해도 안전합니다.** 카카오 계정(`4793460650`)이 이미 `tkisdroid` 계정에
연결돼 있어, 카카오로 로그인해도 **같은 계정·같은 가족으로 복귀**합니다(신규 계정 생성 안 됨).

1. 설정 → 로그아웃
2. 온보딩 → 학부모 → **카카오로 계속하기**
3. 시스템 브라우저에서 카카오 로그인 → 동의
4. 앱으로 자동 복귀 → 부모 홈 (혜니·둘째 그대로 보이면 성공)

---

## 3. 실패 시 진단

Worker가 카카오의 실제 오류 본문을 로깅합니다:
```bash
cd C:\Users\TK\Desktop\hyeni-1\worker
npx wrangler tail --format pretty
```

| 오류 | 원인 | 조치 |
|---|---|---|
| `KOE320` | Redirect URI 불일치 | 1-1 등록 확인(끝의 `/callback`까지 정확히) |
| `KOE205` | 콘솔에 없는 동의항목 요청 | 1-3의 `KAKAO_OAUTH_SCOPE`로 scope 축소 |
| `KOE010` / `invalid_client` | Client Secret 불일치 | 1-4 등록 또는 콘솔에서 끄기 |
| `KOE101` | 앱 키(REST API 키) 오류 | `KAKAO_REST_API_KEY` 재등록 |
| `503 oauth_not_configured` | Worker에 키 없음 | secret 등록 |

> 서버는 키 미설정 시 **가짜 성공 없이 503으로 정직하게 실패**합니다.
