// src/lib/teacherBatch.js
// 선생님 모드 P5 — 묶음 알림 순수 로직(UI 없음, 부수효과 없음).
//
// 비유: 교무실 책상에 둔 '알림 정리 쟁반'. 같은 시간대(예: "10분 뒤")에 움직일 아이들이
//       여러 명이면 쪽지를 한 장씩 따로 주는 대신 "10분 뒤 이동할 아이 3명: 김○○, 박○○, 이○○"
//       처럼 한 장으로 묶어 정리한다. 안전(SOS·위험장소) 쪽지는 이 쟁반에 절대 올리지 않는다 —
//       그건 무조건 즉시·개별로 따로 전달한다(이 파일의 입력에 안전 알림은 들어오지 않는다).
//
// 데이터 계약:
//   입력 scheduleRows = teacherApi.loadClassTodaySchedule 결과 행 배열
//     [{ childMemberId, childName, eventId, title, time, endTime, category, location }]
//   batch_type(teacher_notification_batches CHECK):
//     'departure_soon' | 'arrival_check' | 'attendance_check' | 'dismissal_done' | 'absence_check'
//
// 규칙:
//   - 순수 함수 + immutable. 인자 배열/객체를 변형하지 않고 항상 새 값만 반환한다.
//   - time/endTime 은 'HH:mm' 문자열(events.time 과 동일). 분 단위 정수로 환산해 비교.
//   - 일반인 한글만('이동할'·'아이'·'분 뒤'·'참석 확인'). 영어/개발자 용어 노출 금지.
//   - 안전 알림(SOS/위험장소)은 이 로직의 책임이 아니다(별도 즉시·개별 경로). 묶지 않는다.

// 'HH:mm' → 자정 기준 분(정수). 형식이 어긋나면 null(시간 미상으로 취급).
//   classScheduleBuckets.timeStringToMinutes 와 동일 규칙(중복 import 대신 자립 — 엣지/클라 공용).
export function hhmmToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// 한글 받침(종성) 유무 — 이름 끝 글자 기준. koreanParticle.hasJongseong 과 동일.
function hasJongseong(text) {
  if (!text) return false;
  const last = text.charCodeAt(text.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return false;
  return (last - 0xac00) % 28 !== 0;
}

// 한 아이 이름을 다정한 호칭 + 주격 조사로. 받침 있으면 '○○이가', 없으면 '○○가'.
//   예: '지훈' → '지훈이가', '민지' → '민지가'. 한글이 아니면 이름 + '가'(보수적).
function nameWithSubject(name) {
  const n = String(name || "").trim();
  if (!n) return "아이가";
  return hasJongseong(n) ? `${n}이가` : `${n}가`;
}

// 이름들을 쉼표로 잇는다(빈 이름은 제외, 순서 보존).
function joinNames(names) {
  return (Array.isArray(names) ? names : [])
    .map((n) => String(n || "").trim())
    .filter((n) => n.length > 0)
    .join(", ");
}

// 임박 이동/도착 묶음의 한글 메시지. 1명이면 다정한 단수 문구, 여럿이면 '아이 N명: ...' 묶음.
//   kind: 'departure'(이동) | 'arrival'(도착). minutesLabel: 'N분 뒤' 같은 표시용 라벨.
function buildUpcomingMessage(kind, names, minutesLabel) {
  const verb = kind === "arrival" ? "도착할" : "이동할";
  const singleVerb = kind === "arrival" ? "도착해요" : "이동해요";
  const list = (Array.isArray(names) ? names : []).filter((n) => String(n || "").trim().length > 0);
  if (list.length === 1) {
    // '○○이가 10분 뒤 이동해요'
    return `${nameWithSubject(list[0])} ${minutesLabel} ${singleVerb}`;
  }
  // '10분 뒤 이동할 아이 3명: 김○○, 박○○, 이○○'
  return `${minutesLabel} ${verb} 아이 ${list.length}명: ${joinNames(list)}`;
}

// 시간창 라벨('N분 뒤')을 만든다. 창 하한이 0 이하면 '곧'.
function windowLabelOf(windowLowMinutes) {
  if (!Number.isFinite(windowLowMinutes) || windowLowMinutes <= 0) return "곧";
  return `${windowLowMinutes}분 뒤`;
}

// 같은 시간창(예: 10분 뒤)에 임박한 이동 일정을 아이 단위로 묶는다.
//
//   scheduleRows : loadClassTodaySchedule 행 배열(안전 알림 없음 — 일정만)
//   nowMinutes   : 자정 기준 '지금'(정수 분)
//   windowMin    : 시간창 폭(기본 10분). [now, now+windowMin] 안에 시작하는 일정만 묶음 대상.
//
//   같은 아이가 창 안에 여러 일정이면 가장 이른 한 건만 센다(아이당 1회). 시작 시각이 빠른
//   아이 순으로 이름을 나열하되, 동시각은 입력 순서를 보존한다(안정 정렬).
//
//   반환(immutable): 묶을 게 있으면 단일 원소 배열
//     [{ batchType:'departure_soon', windowLabel, childMemberIds[], childNames[], message }]
//   임박 아이가 없으면 빈 배열 [].
export function groupUpcomingByWindow(scheduleRows, nowMinutes, windowMin = 10) {
  const rows = Array.isArray(scheduleRows) ? scheduleRows : [];
  const now = Number.isFinite(nowMinutes) ? nowMinutes : 0;
  const width = Number.isFinite(windowMin) && windowMin > 0 ? windowMin : 10;
  const upper = now + width;

  // 아이당 가장 이른(임박) 시작 시각만 남긴다.
  const earliestByChild = new Map();
  rows.forEach((row, index) => {
    const start = hhmmToMinutes(row?.time);
    if (start === null) return; // 시간 미상은 묶음 대상 아님
    if (start < now || start > upper) return; // 창 밖(이미 지났거나 너무 먼 미래) 제외
    const key = row?.childMemberId ?? row?.childName ?? `#${index}`;
    const prev = earliestByChild.get(key);
    if (!prev || start < prev.start) {
      earliestByChild.set(key, {
        childMemberId: row?.childMemberId ?? null,
        childName: String(row?.childName || "아이"),
        start,
        order: index,
      });
    }
  });

  const picked = [...earliestByChild.values()].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.order - b.order; // 동시각은 입력 순서 보존(안정)
  });
  if (picked.length === 0) return [];

  const childMemberIds = picked.map((p) => p.childMemberId);
  const childNames = picked.map((p) => p.childName);
  const windowLabel = windowLabelOf(width);
  return [
    {
      batchType: "departure_soon",
      windowLabel,
      childMemberIds,
      childNames,
      message: buildUpcomingMessage("departure", childNames, windowLabel),
    },
  ];
}

// 아직 참석 확인을 안 한(미체크) 아이들을 한 묶음으로 정리한다.
//
//   pendingChildren : [{ childMemberId, childName }] — 참석 미확인 아이만(호출부가 선별).
//                     (attendanceStatus.attendanceBucketOf 가 'need' 인 아이들)
//
//   반환(immutable): 미확인 아이가 있으면 단일 원소 배열
//     [{ batchType:'attendance_check', childMemberIds[], childNames[], message }]
//   없으면 빈 배열 [].
export function buildAttendanceCheckBatch(pendingChildren) {
  const list = (Array.isArray(pendingChildren) ? pendingChildren : []).filter(
    (c) => c && (c.childMemberId || c.childName),
  );
  if (list.length === 0) return [];

  const childMemberIds = list.map((c) => c.childMemberId ?? null);
  const childNames = list.map((c) => String(c.childName || "아이"));
  const message =
    list.length === 1
      ? `${nameWithSubject(childNames[0])} 아직 참석 확인 전이에요`
      : `참석 확인이 남은 아이 ${list.length}명: ${joinNames(childNames)}`;
  return [
    {
      batchType: "attendance_check",
      childMemberIds,
      childNames,
      message,
    },
  ];
}

// 묶음 멱등키 — 같은 선생님·묶음종류·시간창이면 같은 키. cron 이 같은 창을 여러 번 돌아도
//   push_idempotency / 묶음 upsert 에서 중복 발사를 막는다.
//   windowStart 는 시간창 시작 식별자(ISO 문자열 또는 'HH:mm' 등 안정 문자열).
export function makeBatchKey(teacherId, batchType, windowStart) {
  return `teacher_batch:${String(teacherId || "")}:${String(batchType || "")}:${String(windowStart || "")}`;
}
