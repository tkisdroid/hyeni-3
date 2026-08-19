// 아이가 AI 친구에게 "기기 동작"을 부탁했을 때 무엇을 열어 줄지 정하는 순수 판정(2026-08-18 TK 지시).
//
// 원칙: **앱이 대신 바꾸지 않는다.** 소리·진동·무음, 전화, 문자 같은 기기 동작은
// 아이 기기에서 아이가 직접 눌러야 하는 일이다. AI 는 알맞은 화면만 열어 준다.
// 무음 전환을 앱이 대신 해 주면 부모의 SOS·소리 울리기 같은 안전 기능이 조용해질 수 있고,
// 문자·전화를 앱이 몰래 보내면 아이가 무엇을 보냈는지 모르게 된다.

/** 열어 줄 수 있는 화면(화이트리스트). 이 밖의 값은 절대 네이티브로 넘기지 않는다. */
export const DEVICE_ACTION_TARGETS = Object.freeze([
  "alarm",
  "sound",
  "wifi",
  "battery",
  "notifications",
  "location",
  "dial",
  "sms",
]);

/** 전화·문자는 부모 연락 허용 스위치를 따른다(설정 화면 열기는 자유). */
export const CONTACT_DEVICE_ACTION_TARGETS = Object.freeze(["dial", "sms"]);

export function isDeviceActionTarget(value) {
  return typeof value === "string" && DEVICE_ACTION_TARGETS.includes(value);
}

const SOUND_WORDS = ["소리", "볼륨", "벨소리", "진동", "무음", "매너모드", "音", "sound", "volume", "vibrat", "silent", "mute"];
const ALARM_WORDS = ["알람", "깨워", "기상 알림", "alarm"];
const WIFI_WORDS = ["와이파이", "wifi", "wi-fi", "무선"];
const BATTERY_WORDS = ["배터리", "절전", "battery"];
const NOTIFICATION_WORDS = ["알림 설정", "알림설정", "푸시", "notification"];
const LOCATION_WORDS = ["위치 켜", "위치 꺼", "gps", "위치 설정", "위치설정"];
const DIAL_WORDS = ["전화", "통화", "전화기", "call", "다이얼"];
const SMS_WORDS = ["문자", "sms", "메시지 보내", "문자 보내"];

/** "열어 줘"가 아니라 "바꿔 줘/걸어 줘"처럼 대신 해 달라는 부탁도 같은 화면으로 안내한다. */
const REQUEST_WORDS = [
  "열어", "켜", "꺼", "바꿔", "바꾸", "설정", "해줘", "해 줘", "해줄", "걸어", "보내",
  "하고 싶", "하고싶", "키워", "줄여", "올려", "내려", "부탁", "맞춰", "추가", "만들",
];

const SCHEDULE_ALERT_CONTEXT_RE =
  /(?:일정|스케줄|준비물|등교|하교)\s*(?:알림|알람)|(?:알림|알람)\s*(?:시간|몇\s*분\s*전)/;
const ALARM_REMOVE_RE = /꺼|끄|삭제|지워|취소|없애/;

/**
 * 음성 인식 결과의 한국어 시각을 Android AlarmClock extra 로 좁힌다.
 * 날짜는 넘기지 않는다. Android 알람 화면에서 아이가 반복·날짜와 저장을 직접 확인한다.
 */
export function parseDeviceAlarmTime(rawText) {
  const text = typeof rawText === "string" ? rawText.toLowerCase() : "";
  if (!text.trim()) return null;

  const korean = /(새벽|아침|오전|낮|오후|저녁|밤)?\s*(\d{1,2})\s*시(?:\s*(?:(\d{1,2})\s*분|(반)))?/.exec(text);
  const english = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(text);
  const colon = /(새벽|아침|오전|낮|오후|저녁|밤)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(text);

  let qualifier = "";
  let hour = Number.NaN;
  let minute = 0;
  if (korean) {
    qualifier = korean[1] || "";
    hour = Number(korean[2]);
    minute = korean[4] ? 30 : Number(korean[3] || 0);
  } else if (english) {
    qualifier = english[3];
    hour = Number(english[1]);
    minute = Number(english[2] || 0);
  } else if (colon) {
    qualifier = colon[1] || "";
    hour = Number(colon[2]);
    minute = Number(colon[3]);
  } else {
    return null;
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (["오후", "저녁", "밤", "낮", "pm"].includes(qualifier)) {
    if (hour < 1 || hour > 12) return null;
    if (hour < 12) hour += 12;
  } else if (["새벽", "아침", "오전", "am"].includes(qualifier)) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return { hour, minute };
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

/**
 * 아이 문장에서 기기 동작 요청을 찾는다. 요청이 아니면 null.
 * 앱 안에서 처리하는 일(일정·부모 메시지·내 설정)은 다른 판정기가 먼저 가져간다.
 */
export function detectChildDeviceActionIntent(rawText) {
  const text = typeof rawText === "string" ? rawText.toLowerCase() : "";
  if (!text.trim()) return null;
  if (!includesAny(text, REQUEST_WORDS)) return null;

  // "일정 알람 10분 전"은 앱 일정 알림 설정이다. 반면 "아침 7시 알람"은
  // 아이가 직접 바꿀 수 있는 기기 알람이므로 부모 권한으로 돌리지 않는다.
  if (includesAny(text, ALARM_WORDS) && !SCHEDULE_ALERT_CONTEXT_RE.test(text)) {
    const time = ALARM_REMOVE_RE.test(text) ? null : parseDeviceAlarmTime(text);
    return time ? { target: "alarm", ...time } : { target: "alarm" };
  }

  // 문자·전화는 "부모님께 ~라고 전해 줘"(앱 안 메시지)와 구분해야 한다.
  // 앱 대화로 전할 수 있는 부탁은 앞선 판정기가 이미 가져가므로 여기서는 기기 앱만 다룬다.
  if (includesAny(text, SMS_WORDS)) return { target: "sms" };
  if (includesAny(text, DIAL_WORDS)) return { target: "dial" };
  if (includesAny(text, SOUND_WORDS)) return { target: "sound" };
  if (includesAny(text, WIFI_WORDS)) return { target: "wifi" };
  if (includesAny(text, BATTERY_WORDS)) return { target: "battery" };
  if (includesAny(text, NOTIFICATION_WORDS)) return { target: "notifications" };
  if (includesAny(text, LOCATION_WORDS)) return { target: "location" };
  return null;
}
