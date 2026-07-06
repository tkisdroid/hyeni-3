export const meta = {
  name: 'wf-audit',
  description: '와이어프레임 65화면 vs 현재 구현 전수 감사 — 죽은 버튼·누락 기능·누락 화면',
  phases: [{ title: 'Audit', detail: '8개 그룹 병렬 감사' }],
}

const GROUPS = [{"name": "auth-entry", "title": "공통·가입·로그인·진입 (C-01~C-15)", "codes": ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-08", "C-09", "C-10", "C-11", "C-12", "C-13", "C-14", "C-15"], "files": ["src/screens/onboarding/Onboarding.tsx", "src/auth/AuthProvider.tsx", "src/auth/RequireRole.tsx", "src/screens/Placeholder.tsx", "src/app/App.tsx"], "spec": "### C-01  스플래시\n    [ACT] 자동 진입 (최소 1.2s) · 탭 스킵 없음\n    [ST ] 세션 검증 → 로그인\n    [BE ] D1 세션 확인 · 최소버전 체크 → 낮으면 C-14\n\n### C-02  온보딩 (3단계)\n  CTA: 다음\n    [ACT] 스와이프 / 다음 / 건너뛰기 · 3단계 후 가입\n    [DAT] 3컷: 위치 · 일정/알림 · 소통(채팅·스티커)\n    [ST ] 1회만 노출 (로컬 플래그) · 재노출 없음\n\n### C-03  가입 · 로그인 (소셜 우선)\n  CTA: 📱 전화번호로 가입 · 로그인\n    [ACT] 카카오 · 구글 OAuth · 전화번호 경로(C-04)\n    [ST ] 기존 계정 감지 → C-06 연동\n    [BE ] OAuth 토큰 → D1 users upsert · 세션 발급\n\n### C-04  회원가입 (전화번호)\n  CTA: 인증받기 | 확인 | 가입 완료\n    [DAT] 이름· 전화번호·인증번호\n    [ST ] 인증 완료 전 가입 비활성 · 코드 재전송(쿵다운) · 중복 번호 검사\n    [BE ] SMS 인증\n\n### C-05  로그인\n  CTA: 로그인\n    [ACT] 로그인 · 비번찾기(C-07) · 소셜 · 뒤로\n    [ST ] 실패 시 공통 에러 문구(자격증명 불일치) · 5회 잠금\n    [BE ] D1 세션 발급 · refresh 토큰 저장\n\n### C-06  계정 연동 (OAuth)\n  CTA: 계정 연결하기 | 새 계정으로 시작\n    [ACT] 연결 / 새 계정 · 뒤로\n    [ST ] 동일 전화번호 감지 시에만 노출 · 중복가입 방지\n    [BE ] D1 identities 링크 (provider→user_id)\n\n### C-07  비밀번호 재설정\n  CTA: 인증코드 보내기 | 재설정 완료\n    [ST ] 코드 재전송(60s 쿨다운) · 만료/오류 문구\n    [BE ] SMS 발송 · D1 비번 해시 갱신 · 세션 무효화\n\n### C-08  모드 선택\n    [ACT] 부모 → 페어링(P-01) · 아이 → 연결코드 입력 · 선생님 → 학급\n    [ST ] 기기 1대=1역할 고정 · 역할에 맞는 메뉴만 노출\n    [BE ] D1 device_role 저장 · 푸시토큰 등록\n\n### C-09  권한 요청\n  CTA: 권한 한 번에 허용하기\n    [ACT] 한 번에 허용(일괄 요청) · 개별 항목도 탭 가능 · 나중에\n    [ST ] 거부/부분허용 → 설정 유도 배너 · 재요청 딥링크\n    [DAT] 권한 상태 로컬+D1 기록(부모 대시보드 반영)\n\n### C-10  로딩 (스켈레톤)\n    [ST ] 스켈레톤은 실제 레이아웃과 동일 골격만 · 과다 사용 금지\n    [DAT] 홈은 캐시 우선 표시 후 델타만 갱신(체감속도 ↑)\n\n### C-11  빈 상태\n  CTA: + 일정 추가\n    [ST ] 캐릭터 + 한 줄 안내 + 1개 주요 액션(CTA)\n    [DAT] 문맥별 문구(일정/알림/자녀/친구 없음)\n\n### C-12  공통 에러 (재시도)\n  CTA: 다시 시도 | 설정 열기\n    [ST ] 제목·1줄·재시도(·설정)\n    [DAT] 작은 오류코드만 노출(문의용) · 로그는 백엔드\n    [BE ] 지수 백오프 재시도 · 실패 텔레메트리 전송\n\n### C-13  오프라인 (버퍼)\n  CTA: 지금 재연결\n    [ST ] 상단 지속 배너 · 캐시 데이터 흐릿 처리 · 편집은 큐잉\n    [BE ] 오프라인 위치/쓰기 로컬 버퍼 → 복구 시 멱등 RPC\n\n### C-14  앱 업데이트 안내\n  CTA: 업데이트 | 나중에\n    [ST ] 권장(나중에 가능) vs 강제(최소버전 미만 → 나중에 숨김)\n    [BE ] 스플래시의 최소버전 체크 결과로 트리거\n\n### C-15  권한 없음 (재요청)\n  CTA: 설정에서 허용\n    [ACT] OS 설정 딥링크 · 복귀 시 자동 재확인\n    [ST ] 위치·알림·백그라운드·마이크별 전용 문구\n"}, {"name": "parent-home-family", "title": "부모홈·아이목록·상세·페어링·연결 (P-01~P-06)", "codes": ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06"], "files": ["src/screens/parent/ParentHome.tsx", "src/screens/parent/ParentFamily.tsx", "src/screens/feature/ChildInvite.tsx", "src/screens/feature/PhoneSetup.tsx", "src/screens/feature/ProfileEdit.tsx"], "spec": "### P-01  부모 홈\n    [ACT] 아이 탭→상세 · 지도보기 · 알림 · 하단 5탭\n    [DAT] 다음일정 1건 · 자녀 상태/최근위치 · 미니맵\n    [BE ] 홈 요약 1회 쿼리(캐시 우선) · 위치는 폴링/구독\n\n### P-02  아이 목록 (다자녀)\n    [ACT] 아이 탭→상세 · 추가 연결(P-04) · 롱프레스 정렬\n    [DAT] 이름·색·연결/안전 상태 · 최근 위치시각\n    [BE ] D1 children (parent_id) · per-child 구독 티어 확인\n\n### P-03  아이 상세\n  CTA: 📍 실시간 위치 | 🗓 캘린더 | 💬 채팅 | ⭐ 스티커\n    [ACT] 위치·캘린더·채팅·스티커·주변소리 진입 · 프로필 편집\n    [DAT] 프로필·오늘요약·안전상태·바로가기\n    [BE ] 아이 요약 집계(D1) · 주변소리는 프리미엄 게이트\n\n### P-04  페어링 위저드\n  CTA: 다음 · 초대코드 만들기\n    [DAT] 단계1 아이 수 · 2 정보(이름/생일/학년/색/사진) · 3 코드\n    [ST ] 사진 업로드 선택 · 필수값 검증 후 다음 활성\n    [BE ] 아이 사진 R2 업로드\n\n### P-05  초대코드 · QR\n  CTA: 코드 공유하기\n    [ACT] 코드 공유 · 새 코드 · 연결 대기(폴링)\n    [ST ] 만료 타이머 · 아이 연결 시 자동으로 P-06\n    [BE ] D1 pairing_code(만료·1회용) · 아이 입력 검증\n\n### P-06  연결 상태 · 해제\n  CTA: 연결 해제\n    [ACT] 공동보호자 초대(SMS) · 연결 해제(확인 모달)\n    [ST ] 해제 시 양쪽 알림 · 데이터 보존 옵션\n    [BE ] D1 pairing 상태 · co-parent SMS 인증 링크\n"}, {"name": "calendar-schedule", "title": "캘린더·일정·AI·장소·숙제 (P-07~P-13)", "codes": ["P-07", "P-08", "P-09", "P-10", "P-11", "P-12", "P-13"], "files": ["src/screens/parent/ParentCalendar.tsx", "src/screens/feature/AiSchedule.tsx", "src/screens/feature/PlaceForm.tsx", "src/screens/feature/PlaceManager.tsx"], "spec": "### P-07  월간 캘린더\n    [ACT] 날짜 탭→해당일 · 주/월 전환 · 자녀 필터 · + FAB\n    [DAT] 아이별 색 점 · 셀당 최대 표시 후 +N · 하단 선택일 목록\n    [BE ] 보이는 월만\n\n### P-08  일정 상세 (바텀시트)\n  CTA: 삭제 | 수정\n    [ACT] 수정(P-09)·삭제(P-12)·시트 드래그 닫기\n    [DAT] 제목·아이·시간·반복·장소/도착알림·사전알림·메모\n\n### P-09  일정 생성 · 수정 폼\n    [DAT] 제목·아이(다중)·날짜·시간·카테고리·장소·반복·알림·메모\n    [ST ] 저장 중→성공 토스트/실패 재시도 · 필수(제목·시간) 검증\n    [BE ] D1 events upsert → 아이 캘린더 반영\n\n### P-10  AI 일정 등록\n  CTA: 확인하고 저장\n    [ACT] 텍스트·음성· 알림장 사진\n    [ST ] 파싱 중 로딩 · 저신뢰 필드 강조 · 크레딧 소진 시 안내\n    [BE ] 사진 R2 업로드\n\n### P-11  장소 선택 (도착알림)\n  CTA: 이 장소로 도착알림 설정\n    [DAT] 검색/핀 이동 · 좌표·주소 · 도착 반경(지오펜스)\n    [BE ] 지오코딩 프록시 · D1 place 저장 · 장소 변경 시 알림 재설정\n\n### P-12  삭제 확인 · 저장 결과\n  CTA: 취소 | 삭제\n    [ST ] 반복은 범위 선택 · 삭제 실패 시 롤백+재시도 · 성공 스낵바\n    [BE ] D1 삭제→알림 취소·아이 반영 · 스낵바에 동기화 상태\n\n### P-13  숙제 · 준비물\n    [ACT] 추가·체크·사진 첨부 · 아이와 양방향 동기화\n    [BE ] D1 tasks · 사진 R2 업로드\n"}, {"name": "location-safety", "title": "위치·안전·경로·주변소리·SOS수신 (P-14~P-20)", "codes": ["P-14", "P-15", "P-16", "P-17", "P-18", "P-19", "P-20"], "files": ["src/screens/parent/ParentLocation.tsx", "src/screens/feature/RouteView.tsx", "src/screens/feature/RemoteAudio.tsx"], "spec": "### P-14  아이 실시간 위치\n  CTA: ↻ 위치 새로고침 | 🔊 주변소리 | 🧭 경로\n    [DAT] 이름·현재위치 요약·지도· 마지막 갱신\n    [ACT] 새로고침 · 주변소리 · 경로 · 자녀 전환\n    [BE ] 아이 기기 위치 전송→D1→부모 구독 · 갱신 시각/정확도 표기\n\n### P-15  위치 갱신 상태 (3)\n  CTA: 다시 시도\n    [ST ] 갱신중(타임아웃) · 성공 · 실패(재시도) · 권한필요 안내\n    [BE ] 푸시 기반 위치 요청 · 실패 시 마지막 known 위치+시각 유지\n\n### P-16  이동 경로\n    [DAT] 경로 폴리라인 · 출발/도착/체류 · 타임라인\n    [BE ] D1 위치 히스토리 다운샘플 · 보관기간=구독 티어\n\n### P-17  위험구역 (지오펜스)\n    [ACT] 구역 추가/편집 · 반경 · 진입/이탈 알림 토글\n    [BE ] 아이 기기 지오펜스 판정→D1 이벤트→부모 알림(중복 방지)\n\n### P-18  주변소리 듣기\n  CTA: ● 주변소리 켜기 (최대 30초)\n    [ST ] 핵심만 노출 + 안내는 접기\n    [BE ] 프리미엄 게이트 · 세션 생성 · 아이 기기 기록 · 오디오 R2(옵션)\n\n### P-19  소리 울리기\n  CTA: 🔔 지금 울리기\n    [ACT] 지속시간 선택 · 울리기(확인 모달) · 중지\n    [BE ] 고우선 푸시→아이 기기 알람 · D1 이력 · 남용 제한\n\n### P-20  SOS 수신 (긴급)\n  CTA: 📞 | 🔊 주변소리 | 확인함 · 안전 확인 완료\n    [ACT] 전화 · 주변소리 · 실시간 추적 · 확인 처리\n    [ST ] 풀스크린 긴급 · 소리/진동 · 공동보호자 동시 수신\n    [BE ] 최고우선 푸시 · D1 SOS 이벤트 · 자동 위치 고빈도 갱신\n"}, {"name": "notify-social", "title": "알림·채팅·스티커·친구찾기·하루요약 (P-21~P-28)", "codes": ["P-21", "P-22", "P-23", "P-24", "P-25", "P-26", "P-27", "P-28"], "files": ["src/screens/feature/Notifications.tsx", "src/screens/shared/MemoChat.tsx", "src/screens/feature/StickerSend.tsx", "src/screens/feature/FriendPlay.tsx", "src/screens/feature/PlaydateAccept.tsx"], "spec": "### P-21  알림센터\n    [ACT] 탭→상세로 이동 · 필터 · 모두 읽음 · 스와이프 삭제\n    [DAT] 유형·아이·시간·요약 · 미확인 점\n    [BE ] D1 notifications · 페이지네이션 · 읽음 상태 동기화\n\n### P-22  도착 · 미도착 알림\n  CTA: 도착 알림 설정\n    [DAT] 일정명·장소·도착여부·도착시간·거리 · 부모/아이 전송상태\n    [ST ] 도착/미도착/지연 · 중복 방지\n    [BE ] 지오펜스 판정 윈도우 · D1 idempotent · 이중 채널 발송\n\n### P-23  위험 알림 상세\n  CTA: 위험알림 설정 | 확인함\n    [DAT] 위험 유형·발생시간·위치·아이 상태·전송/읽음 상태\n    [ACT] 확인 · 상세(지도) · 위험알림 설정 진입\n    [BE ] 동일 이벤트 중복 알림 방지\n\n### P-24  알림 설정\n    [ACT] 유형별 토글 · 사전알림 시간 · 방해금지 시간대\n    [ST ] 긴급은 방해금지 예외 · OS 알림 꺼짐 시 상단 배너\n    [BE ] D1 notification_prefs · 아이 기기에도 반영\n\n### P-25  부모–아이 채팅\n    [ACT] 메시지·위치공유·사진·정형 문구 · 읽음 표시\n    [BE ] D1 messages · 사진 R2\n\n### P-26  칭찬 스티커 주기\n  CTA: 스티커 보내기\n    [ACT] 스티커 선택 · 메시지 · 보내기 → 아이에게 알림\n    [BE ] D1 stickers · 누적 집계 → 리워드/보관함\n\n### P-27  친구찾기 요청 수락\n  CTA: 거절 | 승인\n    [ACT] 승인 / 거절 · 상세(상대·범위) 확인\n    [ST ] 양측 부모 승인 필요 · 대기/연결됨/해제\n    [BE ] D1 friend_requests · 상호 승인 게이트 · 놀이약속 연동\n\n### P-28  하루 요약 (AI)\n    [DAT] 일정 수행·위치 하이라이트·리워드·안전 이벤트 종합\n    [BE ] 야간 배치 AI 요약(D1 집계) · 프리미엄 · 캐시\n"}, {"name": "child-mode", "title": "아이 모드 (K-01~K-10)", "codes": ["K-01", "K-02", "K-03", "K-04", "K-05", "K-06", "K-07", "K-08", "K-09", "K-10"], "files": ["src/screens/child/ChildHome.tsx", "src/screens/child/StickerBook.tsx", "src/screens/child/ChildSos.tsx", "src/screens/child/AiFriendChat.tsx", "src/screens/shared/MemoChat.tsx"], "spec": "### K-01  아이 홈\n  CTA: 💬 엄마랑 채팅 | 🤖 AI 친구\n    [DAT] 캐릭터·다음일정·스티커수·위치전송 상태\n    [ACT] 채팅·AI친구·일정 · 하단 4탭 (SOS는 항상 접근)\n\n### K-02  오늘 일정\n    [DAT] 부모가 만든 일정 읽기 · 완료 표시 · 다음 강조\n    [BE ] D1 events(read) · 부모 수정 실시간 반영\n\n### K-03  위치 전송 상태\n    [ST ] 전송중(안심) · 꺼짐(켜기 유도) · 권한 필요 안내\n    [BE ] 백그라운드 위치→D1 · 배터리 최적화 · 오프라인 버퍼\n\n### K-04  AI 친구 · 캐릭터\n  CTA: 저장하고 대화하기\n    [ACT] 캐릭터·이름·성격 선택 · 대화 시작\n    [BE ] AI 페르소나(D1 저장) · 아동 안전 가드레일 · 크레딧\n\n### K-05  AI 친구 채팅\n    [ST ] 안전 필터 · 위험 발화 감지 시 부모 알림/도움 안내\n    [BE ] AI 채팅(크레딧) · 모더레이션 · 대화 요약 D1\n\n### K-06  숙제 · 준비물 체크\n  CTA: 다 했어요! 🎉\n    [ACT] 체크 · 사진 첨부 · 직접 추가 → 부모에게 표시\n    [BE ] D1 tasks 양방향 · 사진 R2\n\n### K-07  SOS 송신\n    [ACT] 3초 길게 눌러 발동(오작동 방지) · 취소 유예 5초\n    [BE ] 최고우선 푸시→부모/공동보호자 · D1 SOS · 위치 고빈도\n\n### K-08  스티커 보관함\n    [DAT] 받은 스티커·진행바·보상 목표\n    [BE ] D1 stickers(read) · 보상 규칙은 부모 설정\n\n### K-09  친구찾기 요청\n  CTA: 친구 신청하기\n    [ACT] 친구 코드 입력 · 신청 → 부모 승인(P-27)\n    [BE ] D1 friend_requests · 상호 부모 승인 게이트\n\n### K-10  아이 설정 · 연결 상태\n    [DAT] 프로필·연결 상태·테마·위치/알림(부모 잠금 항목 표시)\n    [ST ] 부모가 잠근 항목은 읽기전용 · 연결 해제 시 안내\n"}, {"name": "teacher", "title": "선생님 모드 (T-01~T-04)", "codes": ["T-01", "T-02", "T-03", "T-04"], "files": ["src/screens/teacher/TeacherHome.tsx", "src/screens/teacher/TeacherStudents.tsx"], "spec": "### T-01  선생님 홈\n  CTA: ＋ 오늘 알림장 작성\n    [DAT] 반·오늘 시간표·알림장 상태·학생 수\n    [BE ] D1 class/timetable · 선생님-반 권한 범위\n\n### T-02  반 시간표\n    [ACT] 셀 편집·과목/준비물·주 복사\n    [BE ] D1 timetable · 변경 → 학부모 캘린더 동기화\n\n### T-03  알림장 · 공지 작성\n  CTA: 24명에게 발송\n    [DAT] 내용·준비물·첨부·반영 토글 · 대상 학생 수\n    [BE ] D1 notice · 첨부 R2\n\n### T-04  학생 · 출결\n    [ACT] 학생별 출/지/결 토글 · 사유 · 저장\n    [ST ] 프라이버시 · 위치/안전 데이터 비노출\n"}, {"name": "subs-settings", "title": "구독·설정 (S-01~S-03, P-29~P-33)", "codes": ["S-01", "S-02", "S-03", "P-29", "P-30", "P-31", "P-32", "P-33"], "files": ["src/screens/feature/Subscription.tsx", "src/screens/parent/ParentSettings.tsx", "src/screens/feature/ProfileEdit.tsx", "src/screens/feature/AiCredit.tsx", "src/screens/feature/Feedback.tsx"], "spec": "### S-01  구독 유도\n  CTA: 월 4,900원으로 시작 | 나중에 하기\n    [ST ] 짧은 제목·1줄·혜택 3·구독/나중에 · 문단설명 지양\n    [ACT] 플랜 비교(S-02) 진입 · 잠금 기능 탭 시 진입\n\n### S-02  플랜 비교 · 결제\n  CTA: 연간 구독하기\n    [DAT] 월/연 플랜·가격·무료·프리미엄 비교표\n    [BE ] Google Play Billing · 엔타이틀먼트 D1 캐시 · 자동갱신 고지\n\n### S-03  체험 종료 · 기능 잠금\n  CTA: 지금 구독하고 계속 쓰기\n    [ST ] 체험 배너(D-2/D-day) · 잠금 오버레이 · 안전기능은 유지\n    [BE ] 엔타이틀먼트 만료 → 프리미엄 게이트 · 안전(SOS·위치) 무료 유지\n\n### P-29  설정 홈\n    [ACT] 각 항목 진입 · 로그아웃 · 탈퇴(확인 모달)\n    [DAT] 프로필·연결·알림·위치·구독·테마·데이터·약관\n\n### P-30  계정 · 프로필\n  CTA: 로그아웃 | 회원 탈퇴\n    [ACT] 프로필 편집 · 비번변경 · 계정연동 · 로그아웃 · 탈퇴\n    [BE ] 사진 R2\n\n### P-31  위치 · 백그라운드\n    [ACT] 권한 관리·백그라운드·주기·배터리 예외·보관기간\n    [BE ] 주기 설정 → 아이 기기 반영 · 성능/배터리 영향 안내\n\n### P-32  데이터 · 동기화 (D1/R2)\n  CTA: 지금 동기화 | 데이터 내보내기 | 캐시 비우기\n    [DAT] D1 마지막 동기화·대기 · R2 파일수/용량 · 오프라인 큐\n    [BE ] D1 델타 동기화 · R2 사용량 조회 · 내보내기(JSON) · 멱등 재전송\n\n### P-33  테마 · 색상\n  CTA: Primary · 아이/감성 | Primary · 부모/안전 | Secondary · 아웃라인 | Destructive · SOS/삭제 | Disabled | 취소 | 확인\n    [ACT] 아이별 색 지정 · 라이트/다크 · 아이 색 선택 위임\n    [BE ] per-child accent(D1) → 런타임 테마(--theme-accent) 주입"}];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['screens'],
  properties: {
    screens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code','name','currentFile','status','deadButtons','missingFeatures','severity'],
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          currentFile: { type: 'string', description: '대응하는 현재 파일 경로. 없으면 "" (빈 문자열)' },
          status: { type: 'string', enum: ['implemented','partial','missing'] },
          deadButtons: {
            type: 'array',
            description: '동작 안 하는/토스트만 뜨는/미배선 버튼·인터랙션',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label','file','line','problem'],
              properties: {
                label: { type: 'string' },
                file: { type: 'string' },
                line: { type: 'integer' },
                problem: { type: 'string', description: '무엇이 안 되는지 한 줄' },
              },
            },
          },
          missingFeatures: {
            type: 'array',
            description: '와이어프레임 spec에 있으나 현재 구현에 없는 기능·구조',
            items: { type: 'string' },
          },
          severity: { type: 'string', enum: ['high','med','low'] },
        },
      },
    },
  },
};

phase('Audit')

const results = await parallel(GROUPS.map((g) => () =>
  agent(
    [
      '너는 혜니캘린더(React+TS+Vite PWA) 코드 감사자다. 아래 와이어프레임 spec과 현재 구현을 대조해, 화면별로 "동작하지 않는 버튼/기능"과 "누락된 화면/구조"를 정밀하게 찾아 보고하라.',
      '',
      '## 담당 그룹: ' + g.title,
      '',
      '## 와이어프레임 spec (담당 화면들)',
      '각 화면: ### 코드 이름 / CTA(버튼 라벨) / NAV(탭) / [ACT]인터랙션 [DAT]데이터 [ST]상태 [BE]백엔드',
      g.spec,
      '',
      '## 감사할 현재 구현 파일 (Read 로 반드시 열어 확인)',
      g.files.map((f) => '- ' + f).join('\n'),
      '',
      '필요하면 Grep/Glob 으로 관련 파일(라우트 App.tsx, 대응 queries/useX.ts, endpoints/X.ts)도 확인하라. onClick 이 navigate/mutate 등 실제 동작을 하는지, 아니면 show()(토스트)만 하거나 아예 핸들러가 없는지 라인 단위로 확인하라.',
      '',
      '## 판정 기준',
      '- deadButtons: onClick 이 없거나, 토스트만 띄우거나("준비 중" 포함), TODO, 빈 함수, 잘못된 navigate 로 실동작이 없는 버튼/인터랙션. label + file + line(1-indexed) + problem(한 줄).',
      '  단, 의도적으로 "준비 중" 안내를 하는 미구현 네이티브 기능(예: 음성캡처)도 spec 상 필요한 기능이면 missingFeatures 로도 적어라.',
      '- missingFeatures: spec의 [ACT]/[DAT]/CTA 중 현재 화면에 아예 없는 기능·UI 구조(예: QR 미표시, 만료타이머 없음, 폴링 없음, 필터 없음 등).',
      '- status: implemented(거의 완전) / partial(일부 동작) / missing(대응 파일 자체가 없음).',
      '- currentFile: 실제로 대응하는 파일 경로 1개(없으면 빈 문자열).',
      '',
      '실제로 파일을 열어 확인한 사실만 보고하라. 추측 금지. 담당 화면 전부(누락=missing 포함)를 screens 배열에 넣어라.',
    ].join('\n'),
    { label: 'audit:' + g.name, schema: SCHEMA, effort: 'high' }
  )
));

const merged = [];
results.filter(Boolean).forEach((r) => { if (r && r.screens) merged.push(...r.screens); });
return { screens: merged };
