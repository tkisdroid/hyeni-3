# 혜니 Redesign 포트 — 컴포넌트 색상 변경 내역 (old → new)

각 컴포넌트에서 바꾼 **색 값만** 모았습니다. 전부 하드코딩된 낱개 색상(차가운 회색·파랑)을
따뜻한 토큰으로 교체한 것이며 **로직·구조·문구는 그대로**입니다.

> 경로 접두어: `src/components/`
> ℹ️ 참고: 확인해 보니 로컬(`hyeni-1`)의 아래 7개 파일은 **이미 이 값으로 패치된 상태**예요.
> 이미 반영하셨다면 그대로 두시면 되고, 이 문서는 "무엇이 바뀌었는지" 검토용 레퍼런스입니다.

각 항목은 `찾기(옛) → 바꾸기(새)` 형식입니다.

---

## `memo/MemoSection.jsx` — 부모/아이 대화(채팅)

- 빈 상태 텍스트 색: `"#D1D5DB"` → `"var(--fg-tertiary)"`
- 날짜 구분선 `<hr>` (2곳): `"1px solid #E5E7EB"` → `"1px solid var(--line-soft)"`
- 받은 말풍선 글자색: `"#374151"` → `"var(--fg-primary)"`
- 예전 메모 말풍선 테두리: `"1px dashed #FBBF24"` → `"1px dashed var(--status-caution)"`
- 입력 바 배경: `"#FAFAFA"` → `"var(--bg-subtle)"`
- 입력창 비포커스 테두리: `... : "#E5E7EB"` → `... : "var(--line-soft)"`
- 전송 버튼 비활성 배경: `: "#E5E7EB"` → `: "var(--bg-muted)"`

_변경 7곳_

---

## `parent/EventAddScreen.jsx` — 새 일정 · 일정 수정 시트

- 전송 대상 안내 문구 색: `"#2563EB"` → `"var(--theme-accent-text)"`
- 빠른 선택 프리셋 비활성 글자: `... : "#6B7280"` → `... : "var(--fg-secondary)"`
- 위치 "지우기" 버튼 테두리: `"1.5px solid #D1D5DB"` → `"1.5px solid var(--line-default)"`
- 매주 반복 토글 OFF 배경: `: "#E5E7EB"` → `: "var(--bg-muted)"`
- 반복 개월 버튼 비활성 글자: `... : "#6B7280"` → `... : "var(--fg-secondary)"`

_변경 5곳_

---

## `dangerZone/DangerZoneManager.jsx` — 조심할 곳(위험지역) 관리

- zoneColor 기본값: `|| "#6B7280"` → `|| "var(--fg-secondary)"`
- "조심할 곳 추가" 점선 버튼: `"2px dashed #D1D5DB"` → `"2px dashed var(--line-default)"`
- 추가 패널 테두리: `"1.5px solid #E5E7EB"` → `"1.5px solid var(--line-soft)"`
- 이름 입력창 테두리: `"2px solid #E5E7EB"` → `"2px solid var(--line-soft)"`
- 타입 버튼 비활성 테두리: `"1.5px solid #E5E7EB"` → `"1.5px solid var(--line-soft)"`
- 타입 버튼 비활성 글자: `: "#6B7280"` → `: "var(--fg-secondary)"`
- 지도 컨테이너 테두리: `"2px solid #E5E7EB"` → `"2px solid var(--line-soft)"`
- 위치 선택 완료 라벨: `"#059669"` → `"var(--status-safe-text)"`
- (유지) 🌊 수변지역 `"#3B82F6"` — 의미 있는 신호색(파랑=물)이라 보존

_변경 8곳 · 유지 1곳_

---

## `aiSchedule/AiScheduleModal.jsx` — AI 일정등록

- 텍스트 입력창 테두리: `"2px solid #E5E7EB"` → `"2px solid var(--line-soft)"`
- 첨부 이미지 테두리: `"2px solid #E5E7EB"` → `"2px solid var(--line-soft)"`
- 분석 버튼 로딩 배경: `"#9CA3AF"` → `"var(--fg-tertiary)"`
- (유지) CATS 카테고리 팔레트 — 앱 `--hyeni-cat-*` 토큰과 동일한 의미색이라 보존

_변경 3곳_

---

## `map/LocationMapView.jsx` — 부모 위치 지도

- 다중 자녀 마커 기본색: `|| "#3B82F6"` → `|| "#F779A8"`
- 단일 자녀 점 배경: `background:#3B82F6` → `background:var(--theme-accent)` / 그림자 `rgba(59,130,246,0.5)` → `rgba(247,107,166,0.5)`
- 일정 장소 마커(도착) 배경·삼각형 (2곳): `'#059669'` → `'var(--status-safe)'`
- 🎯 재중심 버튼 글자: `DESIGN.colors.parentDeep` → `"var(--theme-accent)"` / 그림자 `rgba(37,99,235,0.18)` → `rgba(31,24,28,0.12)`
- "N개 도착" 칩 글자: `"#065F46"` → `"var(--status-safe-text)"`
- 위치 안내 "!" 배지 배경: `"#FBBF24"` → `"var(--status-caution)"`
- 빈 상태 텍스트: `"#D1D5DB"` → `"var(--fg-tertiary)"`
- 리스트 도착 체크: `"#059669"` → `"var(--status-safe-text)"`

_변경 9곳_

---

## `childTracker/ChildTrackerOverlay.jsx` — 아이 이동 추적 오버레이

- 이동반경 원 stroke/fill: `"#2563EB"` / `"#3B82F6"` → `"#E65C92"` / `"#F779A8"`
- 궤적 커서 색: `"#111827"` → `"#201A1D"`
- 예상경로 점선: `"#9CA3AF"` → `"#B0A8AC"`
- 도착 마커 배경: `"#059669"` → `"#15936B"`
- 범례 "이동" 스와치: `"#3B82F6"` → `"var(--theme-accent)"`
- 범례 "예상" 스와치 (배경·점선): `"#9CA3AF"` → `"var(--fg-tertiary)"`
- 시트 손잡이: `"#D1D5DB"` → `"var(--line-default)"`
- "도착 완료" 글자: `"#059669"` → `"var(--status-safe-text)"`
- 위치 재요청 버튼 배경: `"#FCD34D"` → `"var(--status-caution)"`

_변경 9곳_

---

## `route/RouteOverlay.jsx` — 길안내 경로

- 경로 폴리라인: `"#4285F4"` → `"#E65C92"`
- 도보 화살표: `"#4285F4"` → `"#E65C92"`
- "도착했어요" 제목: `"#059669"` → `"var(--status-safe-text)"`
- "내 위치 찾기" 버튼 배경: `linear-gradient(135deg, #4285F4, #1A73E8)` → `var(--hyeni-theme-gradient)` / 그림자 `rgba(66,133,244,0.3)` → `var(--hyeni-theme-shadow-soft)`
- "위치 찾는 중" 텍스트: `"#4285F4"` → `"var(--theme-accent-text)"`
- 나침반 남측 폴리곤: `fill "#D1D5DB" stroke "#9CA3AF"` → `fill "var(--line-strong)" stroke "var(--fg-tertiary)"`
- 도착 칩 글자: `"#166534"` → `"var(--status-safe-text)"`
- 닫기 버튼 테두리: `"1px solid #E5E7EB"` → `"1px solid var(--line-soft)"`

_변경 8곳_

---

**합계: 49곳 · 파일 7개.** 전부 색 문자열 값 교체이며 로직은 무변경입니다.
사용한 토큰(`--status-safe`, `--status-safe-text`, `--line-default`, `--fg-tertiary`,
`--status-caution` 등)은 모두 실제 `tokens.css`에 존재함을 확인했습니다.
