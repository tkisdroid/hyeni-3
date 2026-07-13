# Play 출시 체크리스트 — 혜니캘린더 v1.2(versionCode 3)

## 준비된 것 (2026-07-13)
- [ ] 최신 서명 릴리즈 AAB 재빌드 필요: 현재 `android/app/build/outputs/bundle/release/app-release.aab`은
  2026-07-10 산출물이라 2026-07-13 스토어 방문 혜택·Billing 진단 변경이 포함되지 않았다. 재빌드 전 업로드 금지.
- [x] 업로드 키스토어: `android/keystore/hyeni-upload.jks` (gitignore 처리)
  - ⚠️ **자격 정보: `android/keystore/hyeni-upload-credentials.txt` — 비밀번호 관리자로 옮기고 파일 삭제!**
  - 재빌드: `cd android && gradlew bundleRelease -PHYENI_KEYSTORE=../keystore/hyeni-upload.jks -PHYENI_KEYSTORE_PASSWORD=<pw> -PHYENI_KEY_ALIAS=hyeni-upload -PHYENI_KEY_PASSWORD=<pw>`
- [x] 등록정보 문안: `docs/store/play-listing.md`
- [x] 데이터 보안 설문 답안: `docs/store/play-data-safety.md`
- [x] 개인정보처리방침/데이터 삭제 URL(Worker 서빙): /privacy, /data-deletion
- [x] 스크린샷 초안: `output/store-screenshots/` (아래 주의 참조)
- [x] 무료 7일 체험: Google Play가 현재 계정에 eligible로 반환한 정확한 7일 offer만 표시·구매
- [x] 구독 상태: 앱 foreground 재검증 + Google Play RTDN 수신·재검증 코드, 멱등/lease/owner binding 구현
- [x] 구독 티어 위치: 무료 잠금, 스토어 방문 혜택 15분 지연, 프리미엄 실시간을 서버에서 강제
- [x] 스토어 혜택 문구: 평점·리뷰 대가로 오해되지 않도록 "스토어 방문 혜택"으로 고정
- [x] production Worker 배포: Version `609cb48a-cf1a-4b47-a5b0-6f4758f7f8d7`, health 200,
  Qonversion 미설정 `configured:false`, RTDN 미설정 503 fail-closed 확인
- [x] production Pages 배포: `hyeni-calendar.pages.dev`가 2026-07-13 build asset `index-BkUQcvh9.js` 제공
- [x] debug APK 실기기 설치: A17·S25 `install -r` 성공, 두 기기 부모 세션과 `/api/family/mine` 정본 일치 확인

## 출시 전 외부 설정 — 아직 미완료

- [x] `google-play-rtdn-schema.sql` production D1 적용 및 컬럼·인덱스 확인(2026-07-13, 빈 테이블로 시작)
- [ ] Android Publisher API 활성화 및 service account에 Play Console 구독 조회 권한 부여
- [ ] Pub/Sub topic을 Play Console RTDN에 연결하고 인증 push subscription 구성
- [ ] Worker에 `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PACKAGE_NAME`,
  `GOOGLE_PLAY_RTDN_AUDIENCE`, `GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL` secret 설정
- [ ] license tester 계정으로 7일 체험·갱신·해지·grace·복원·RTDN 실제 결제 E2E 수행
- [ ] Qonversion은 현재 결제 정본이 아니므로 활성 결제 경로처럼 설정하거나 안내하지 않기

## TK가 해야 하는 것 (Play Console)
1. **앱 만들기**: com.hyeni.calendar, 한국어(ko-KR), 무료(인앱 구독 있음)
2. **Play 앱 서명 사용**(기본) → 위 AAB 업로드(내부 테스트 트랙 권장)
3. **앱 콘텐츠 섹션 전부 작성**:
   - 개인정보처리방침 URL 입력
   - 데이터 보안 설문 → `play-data-safety.md` 그대로
   - 콘텐츠 등급 설문: 폭력/성/도박 없음, 사용자 간 통신 있음(가족 간), 위치 공유 있음 → 전체이용가(3+) 예상
   - 민감 권한 선언: 백그라운드 위치(가족 위치 공유 데모 영상 필요), PACKAGE_USAGE_STATS(자녀 보호), FULL_SCREEN_INTENT(긴급 알림)
   - 대상 연령 설정(listing 문서의 권고 참조)
4. **구독 상품 등록**: hyeni_premium (monthly-2900 / annual-27840 base plan) — 앱 내 표시가와 Console 실제 가격 일치 확인
   - 두 base plan에 정확한 7일 무료 체험 offer를 설정하고 license tester eligibility를 별도로 확인
5. **스크린샷 교체**: 현재 초안엔 실사용 데이터(아이 사진·실주소 지도)가 포함 — **데모 계정으로 재촬영 필수**
6. 피처 그래픽 1024×500 제작
7. 내부 테스트 → 비공개 테스트(20명·14일, 신규 개발자 계정인 경우) → 프로덕션

## 주의(정책 리스크)
- 백그라운드 위치 선언은 심사가 엄격 — 온보딩의 동의 화면과 기능 데모 영상(30초 내외)을 준비하면 통과율이 높음
- PACKAGE_USAGE_STATS 는 자녀 보호 허용 사례로 선언(설명 문구에 "자녀 보호" 명시)
- 아동 관련 앱 정책: 대상 연령에 아동 포함 시 광고·데이터 요건 강화(본 앱 광고 없음)
