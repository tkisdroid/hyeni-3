import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  isValidNotificationQuietHours,
  minuteOfDayToTimeInput,
  notificationQuietHoursRange,
  timeInputToMinuteOfDay,
} from "../src/transform/notificationQuietHours.ts";

test("quiet 기본값은 비활성 22:00~07:00이다", () => {
  assert.deepEqual(DEFAULT_NOTIFICATION_QUIET_HOURS, {
    enabled: false,
    startMinute: 1320,
    endMinute: 420,
    updatedAt: null,
    configured: false,
  });
});

test("quiet 분과 입력 시간을 손실 없이 변환한다", () => {
  assert.equal(minuteOfDayToTimeInput(1320), "22:00");
  assert.equal(minuteOfDayToTimeInput(420), "07:00");
  assert.equal(minuteOfDayToTimeInput(-1), "");
  assert.equal(minuteOfDayToTimeInput(1440), "");
  assert.equal(minuteOfDayToTimeInput(60.5), "");

  assert.equal(timeInputToMinuteOfDay("00:00"), 0);
  assert.equal(timeInputToMinuteOfDay("23:59"), 1439);
  assert.equal(timeInputToMinuteOfDay("24:00"), null);
  assert.equal(timeInputToMinuteOfDay("7:00"), null);
  assert.equal(timeInputToMinuteOfDay("07:60"), null);
  assert.equal(timeInputToMinuteOfDay("07:00 "), null);
});

test("quiet draft는 boolean과 유효 분 범위 및 서로 다른 시각만 허용한다", () => {
  assert.equal(
    isValidNotificationQuietHours({ enabled: true, startMinute: 1320, endMinute: 420 }),
    true,
  );
  assert.equal(
    isValidNotificationQuietHours({ enabled: false, startMinute: 600, endMinute: 600 }),
    false,
  );
  assert.equal(
    isValidNotificationQuietHours({ enabled: true, startMinute: -1, endMinute: 420 }),
    false,
  );
  assert.equal(
    isValidNotificationQuietHours({ enabled: true, startMinute: 1320, endMinute: 1440 }),
    false,
  );
  assert.equal(
    isValidNotificationQuietHours({ enabled: 1, startMinute: 1320, endMinute: 420 }),
    false,
  );
});

test("Asia/Seoul 조용한 시간 범위를 자연스러운 한국어로 표시한다", () => {
  assert.equal(
    notificationQuietHoursRange({ enabled: true, startMinute: 1320, endMinute: 420 }),
    "밤 10시부터 아침 7시까지",
  );
  assert.equal(
    notificationQuietHoursRange({ enabled: true, startMinute: 0, endMinute: 65 }),
    "자정부터 새벽 1시 5분까지",
  );
  assert.equal(
    notificationQuietHoursRange({ enabled: true, startMinute: 750, endMinute: 1110 }),
    "낮 12시 30분부터 저녁 6시 30분까지",
  );
});
