export const definitions = {
  leftNear: ["location", "child", "place"], forceReminder: ["sos"],
  arrived: ["location", "child", "place"], arrivedFrom: ["location", "child", "place", "from"], left: ["location", "child", "place"],
  scheduleArrived: ["location", "child", "event"], scheduleLate: ["location", "child", "event"], scheduleMissing: ["location", "child", "event"],
  dangerEnter: ["danger", "child", "place"], dangerExit: ["danger", "child", "place"],
  stale: ["connection", "child", "minutes"], powerOff: ["connection", "child"], recovered: ["connection", "child"], unpair: ["connection", "child", "hours"],
  stay: ["location", "child", "place"], sos: ["sos", "child"], lowBattery: ["connection", "child"],
  childDangerEnter: ["child"], childDangerExit: ["child"],
  reminder: ["reminder", "event", "minutes"], reminderNow: ["reminder", "event"], childReminder: ["reminder", "event", "minutes"], childReminderNow: ["reminder", "event"],
} as const;
