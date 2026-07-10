# 네이버 소셜 로그인 설정 가이드

**현재 상태(2026-07-10)**: 서버(Worker)는 **이미 구현 완료**, 클라이언트(hyeni-3) 배선과 키 등록만 남음.

| 구성요소 | 상태 |
|---|---|
| Worker 라우트 `GET/POST /api/auth/naver` | ✅ 구현됨 (`hyeni-1/worker/routes/naver-auth.ts`) |
| Worker secret `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | ❌ 미등록 |
| 클라 `VITE_NAVER_CLIENT_ID` | ❌ 빈 값 |
| 온보딩 "네이버로 계속하기" 버튼 | ❌ 없음 (카카오·구글만) |
| 안드로이드 딥링크 `hyenicalendar://auth-callback` | ✅ 매니페스트 등록됨 |

---

## 1. TK가 네이버 개발자센터에서 할 일

https://developers.naver.com/apps/#/register 에서 애플리케이션 등록.

### 1-1. 기본 정보
- **애플리케이션 이름**: 혜니캘린더
- **사용 API**: `네이버 로그인` 선택

### 1-2. 제공 정보 선택 (필수/선택)
서버 코드(`naver-auth.ts:172-174`)가 사용하는 항목만 요청하면 됩니다.

| 항목 | 필요 여부 | 사용처 |
|---|---|---|
| **회원이름(name)** | 필수 | 부모 표시 이름 |
| **이메일 주소(email)** | 필수 | 계정 식별 (없으면 `naver-{id}@hyeni.local` 폴백) |
| 별명(nickname) | 선택 | 이름 없을 때 폴백 |
| 프로필 사진 | 선택 | 미사용 (요청 안 해도 됨) |

> 회원이름·이메일은 네이버 검수(“동의 항목 추가 심사”)가 필요할 수 있습니다.

### 1-3. 서비스 환경 (중요)

**PC 웹**
- 서비스 URL: `https://hyeni-calendar.pages.dev`
- **Callback URL**: `https://hyeni-calendar-api.tkisdroid.workers.dev/api/auth/naver`

**모바일 웹** (선택, PWA용)
- 서비스 URL: `https://hyeni-calendar.pages.dev`
- Callback URL: 위와 동일

> ⚠️ Callback URL은 **Worker 주소**입니다(앱/웹 주소가 아님). 네이버가 이 주소로 `code`를 보내면
> Worker가 앱 딥링크(`hyenicalendar://auth-callback`)나 웹 origin으로 되돌립니다.
> **Android/iOS 앱 환경은 등록하지 않아도 됩니다** — 네이티브도 시스템 브라우저 → Worker 콜백 →
> 딥링크 복귀 흐름을 쓰기 때문입니다.

### 1-4. 발급받을 값
- **Client ID**: 공개값. 앱 번들에 들어갑니다.
- **Client Secret**: 비공개값. **절대 앱/저장소에 넣지 마세요.** Worker secret에만 등록합니다.

---

## 2. 키 등록 (TK 직접 실행)

### 2-1. Worker secret (Client Secret은 여기에만)
```bash
cd C:\Users\TK\Desktop\hyeni-1\worker
npx wrangler secret put NAVER_CLIENT_ID       # 입력창에 Client ID 붙여넣기
npx wrangler secret put NAVER_CLIENT_SECRET   # 입력창에 Client Secret 붙여넣기
```
> 미등록 상태에서 호출하면 서버가 `503 naver_not_configured`로 정직하게 실패합니다(가짜 성공 없음).

### 2-2. 클라이언트 .env (Client ID만)
```
# C:\Users\TK\Desktop\hyeni-3\.env
VITE_NAVER_CLIENT_ID=<발급받은 Client ID>
```
Client ID가 비어 있으면 온보딩에서 네이버 버튼이 **자동으로 숨겨집니다**(`hasNaverClientId` 게이트).

---

## 3. 남은 코드 작업 (내가 처리)

1. `src/lib/api/endpoints/auth.ts`
   - `OAuthProvider` 타입에 `"naver"` 추가
   - 네이버는 카카오/구글과 **계약이 다름**:
     - 카카오/구글: `GET {API_BASE}/api/auth/oauth/{provider}/start` (Worker가 인가 URL 생성)
     - 네이버: 클라가 직접 `https://nid.naver.com/oauth2.0/authorize` 로 이동
       (`response_type=code`, `client_id`, `redirect_uri={API_BASE}/api/auth/naver`,
        `state=base64({nonce,target})`)
   - 콜백 완료는 `POST {API_BASE}/api/auth/naver` 에 `{code, state, redirect_uri}` 전송 → 세션 수신
2. `src/screens/onboarding/Onboarding.tsx`
   - `hasNaverClientId`일 때만 "네이버로 계속하기" 버튼 렌더(네이버 그린 `#03C75A`, 브랜드 가이드 준수)
3. `oauthDeepLink` 핸들러에 `provider=naver` 분기
4. 회귀 테스트 + 실기기 E2E

---

## 4. 브랜드 가이드 주의
- 버튼 색상 `#03C75A`(네이버 그린), 로고는 네이버가 배포한 공식 에셋만 사용
- 문구는 "네이버로 로그인" 또는 "네이버로 계속하기"
- 심사 시 로그인 버튼 노출 화면 스크린샷 요구될 수 있음

## 5. 검수/제출 관련
- 네이버 로그인은 개발 상태에서도 **본인 계정으로 테스트 가능**
- 일반 사용자에게 열려면 "검수 요청" 필요(제공 항목·서비스 설명·화면 캡처 제출)
- Play Store 출시 전 검수 완료 권장
