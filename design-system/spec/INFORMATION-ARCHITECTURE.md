# 정보구조 · 기능 명세 / Information Architecture & Feature Spec — 혜니캘린더

> 「혜니캘린더 리디자인」 프로토타입 기준. 화면·네비게이션·역할·기능·데이터·이벤트 전체.
> Screen inventory, navigation, roles, features, data model and events.

---

## 1. 역할 & 모드 / Roles & Modes

| 역할 / Role | 강조색 | 핵심 목적 / Core job |
|---|---|---|
| 부모 / Parent | 로즈 | 아이 위치·안전 확인, 오늘 일정 관리, 대화, 기기 상태, AI 크레딧 충전 |
| 아이 / Child | 로즈 | AI 친구와 대화, 다음 일정·길찾기, 부모와 대화, 스티커, 친구 놀이요청, SOS |
| 선생님 / Teacher | 민트 | 학교·반 등록 → 부모 전화번호 매칭 → 반 아이들 일정(알림장) 관리 |

- **모드 전환 / Mode switch:** 앱은 계정 역할에 따라 셸이 다름. 데모에선 사이드 레일/스크린 메뉴로 전환. 실제 앱은 로그인 역할로 결정, 부모↔아이는 같은 기기에서 전환 가능(패밀리 페어링).
- 셸마다 하단 탭이 다름(아래 2절).

---

## 2. 네비게이션 모델 / Navigation model

4개 레이어:
1. **모드 셸 / Mode shell** — 역할별 루트.
2. **하단 탭 / Bottom tab** — 모드 안의 최상위 목적지.
3. **푸시 스택 / Push stack** — 상세·기능 화면(뒤로가기). 탭바 숨김.
4. **오버레이 / Overlays** — 바텀시트(빠른 액션·이벤트 상세) + 모달(통화 등) + 토스트.

**하단 탭 / Bottom tabs**
- 부모: 홈 · 캘린더 · 위치 · 대화 · 설정
- 아이: 홈 · 스티커 · 대화 · (꾹 SOS는 상시 노출 액션)
- 선생님(제작 예정): 홈(반) · 반 캘린더 · 학생 · 설정

---

## 3. 화면 인벤토리 / Screen inventory

### 3.1 부모 / Parent
| 화면 | 목적 | 핵심 컴포넌트 | 데이터 |
|---|---|---|---|
| 부모 홈 `p_home` | 하루 요약 진입점 | 오늘 히어로, 오늘의 일정(타임라인 카드), AI 일정추가 카드, 아이 현황 카드, 안전 지표(+최근 앱3), 준비물·숙제, 대화 프리뷰, 바로가기 그리드 | Child, Event[], SafetyStat, AppUsage[], PrepItem[], Message |
| 캘린더 `p_calendar` | 월간 일정 | 달력 그리드, 이벤트 칩, 선택일 상세 | Event[] |
| 위치 `p_location` | 실시간 지도 | 지도, 아이 칩, 바텀 상세(통화·듣기·메모), 상태 | Location, Place[], DangerZone[] |
| 대화 `p_memo` | 부모↔아이 메시지 | 말풍선 리스트, 스티커 메시지, 빠른답장, 입력 | Message[] |
| 가족 `p_family` | 가족·프로필 관리 | 보호자 리스트, 아이 프로필(배터리·위치), 아이 추가 | Guardian[], Child[] |

### 3.2 아이 / Child
| 화면 | 목적 | 핵심 컴포넌트 | 데이터 |
|---|---|---|---|
| 아이 홈 `c_home` | 친구·하루 | AI 친구 히어로(말풍선+대화 버튼), 다음 일정+길찾기, 바로 할 수 있어(대화·친구놀기·스티커), 부모님 전화, 오늘 시간표, 준비물·숙제, 꾹 SOS | AICredit, Event, PrepItem[], Guardian[] |
| 스티커 `c_sticker` / 스티커북 `stickerBook` | 받은 보상 | 스티커 그리드 | Sticker[] |
| 대화 `c_memo` | 부모와 대화 | 말풍선, 빠른답장(꾹 인사·도착·답례) | Message[] |
| 꾹 SOS `c_sos` | 긴급 연결 | 3초 홀드 버튼, 카운트다운, 연결 상태 | Guardian[] |

### 3.3 공용 · 기능 / Shared & feature (push)
온보딩 `onboarding`(역할선택·로그인·가입·연결·페어링·권한) · 구독 `subscription` · 설정 `settings` · 주변소리 `remoteAudio` · 알림센터 `notifications` · 장소관리 `placeManager` · 친구놀이 `friendPlay` · **AI 일정추가 `aiSchedule`**(음성·텍스트·알림장 탭) · **AI 크레딧 `aiCredit`**(잔액·충전팩·자동충전) · 혜니 AI 친구 `aiFriend` · **피드백 `feedback`**(별점·카테고리·자유입력·기능투표) · 디자인시스템 `designSystem`.

### 3.4 선생님 / Teacher — 제작 예정 / To build
| 화면 | 목적 |
|---|---|
| 선생님 온보딩 | 역할=선생님 선택 → **학교·반 이름 등록** → **부모 전화번호로 학생 매칭**(초대/승인) |
| 반 홈 | 담당 반 개요, 오늘 알림장, 결석/참석 현황 |
| 반 캘린더 | 반 공통 일정 등록·공유(부모/아이 캘린더에 반영) |
| 학생 목록 | 매칭된 학생·보호자, 개별 알림/메모 |
> 매칭 규칙: 선생님이 등록한 반에 보호자 전화번호를 초대 → 부모 승인 시 아이 일정이 연결. 개인정보 최소 수집, 부모 동의 필수.

---

## 4. 핵심 플로우 / Key flows

1. **온보딩** 역할선택(부모/아이/**선생님**) → 로그인/가입 → 가족(또는 반) 연결 → 권한(위치·알림·마이크) → 홈.
2. **AI 일정 등록** 부모 홈 "AI로 일정 추가"(음성/텍스트/알림장) → 입력 → **AI 인식 결과** 카드 확인 → "추가" → 캘린더 + 아이 일정 반영.
3. **친구 놀이요청(아이 발신)** 아이 홈 "친구랑 놀기" → 근처 친구 선택 → "같이 놀자고 보내기" → **부모는 요청을 수락**(수락 화면, 제작 예정) → 상대 가족에 전달.
4. **칭찬 스티커 보내기(부모 발신)** 상황별 스티커 선택 → 아이에게 전송 → 아이 대화/스티커북에 도착. (제작 예정: 부모측 스티커 선택 UI)
5. **꾹 SOS(아이)** 3초 홀드 → 카운트다운 → 보호자 전원에 위치+알림, 통화 연결.
6. **AI 크레딧** 부모가 크레딧 팩 구매(30/100/300회) → 아이의 혜니 대화에 사용. 자동충전 옵션.
7. **피드백** 설정 → 피드백 → 별점·카테고리·자유입력·기능 투표 → 전송.

---

## 5. 데이터 모델 스케치 / Data model sketch
```
Family { id, guardians[], children[], plan }
Guardian { id, name, role:'mom'|'dad'|..., avatar, phone }
Child { id, name, grade, animal, avatar, deviceStatus, locationId }
Teacher { id, name, school, className, students[] }   // students = Child refs via parent-phone match
Event { id, childId, category, title, place, start, end, source:'manual'|'ai-voice'|'ai-text'|'ai-note'|'class' }
Place { id, name, address, type:'home'|'academy'|'frequent', geo }
DangerZone { id, name, address, geo, radius }
PrepItem { id, childId, label, done, kind:'prep'|'hw', date }
Sticker { id, code, label, fromGuardianId, toChildId, sentAt }
Message { id, threadId, from:'parent'|'child', text?, stickerCode?, time, read }
AICredit { childId, balance, autoRecharge }
SafetyStat { childId, battery, screenTime, charging, network, recentApps[] }
Notification { id, type, title, detail, time, unread }
Feedback { rating, category, text, featureVotes[] }
```

## 6. 알림/딥링크 이벤트 / Push & deeplink events
`arrival`(안전구역 도착) · `danger`(위험구역 진입) · `sos` · `depart`(출발) · `remind`(일정) · `sticker`(스티커 수신) · `playdate`(놀이요청/수락) · `message` · `credit-low` · `class-note`(선생님 알림장) · `feedback-reply`.

## 7. 상태·엣지 / States & edges
- 아이 1명 가정(현재 데모): 아이 현황은 단일 와이드 카드. 다자녀 확장 시 그리드로 전환.
- 빈 상태: 마스코트 + 다정한 안내 문구.
- 오프라인/권한 거부: 기능별 폴백 + 재요청 유도(공포 문구 금지).
