import { appDateKeyAt, minuteOfDayInTimeZone, wallTimeToEpoch } from "../../shared/timeZone.ts";

/** 가족 현지 시각에서 아직 지나지 않은 다음 30분 경계. 자정·DST 전환도 함께 이동한다. */
export function nextEventDefault(timeZone: string, nowMs = Date.now()) {
  const dateKey = appDateKeyAt(nowMs, timeZone);
  let minute = (Math.floor(minuteOfDayInTimeZone(nowMs, timeZone) / 30) + 1) * 30;
  let epoch = wallTimeToEpoch(dateKey, minute, timeZone);
  while (epoch <= nowMs) {
    minute += 30;
    epoch = wallTimeToEpoch(dateKey, minute, timeZone);
  }
  const localMinute = minuteOfDayInTimeZone(epoch, timeZone);
  return {
    dateKey: appDateKeyAt(epoch, timeZone),
    time: `${String(Math.floor(localMinute / 60)).padStart(2, "0")}:${String(localMinute % 60).padStart(2, "0")}`,
  };
}
