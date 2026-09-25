import { makeNotificationCopy, type NotificationCopy, type NotificationCopyId } from "../../shared/notificationCopy.ts";

const publicKinds: Record<string, NotificationCopyId> = {
  place_arrived: "arrived", place_left: "left", arrived: "scheduleArrived", late_arrived: "scheduleLate",
  sos: "sos", emergency: "sos", sos_followup: "sos", low_battery: "lowBattery",
};

// 아이의 설정 변경 요청은 메뉴마다 문장이 다르다. 허용 목록 밖의 메뉴는 번역 없이 원문만 둔다.
const settingRequestKinds: Record<string, NotificationCopyId> = {
  theme: "settingRequestTheme", character: "settingRequestCharacter",
  sound: "settingRequestSound", mascot: "settingRequestMascot",
};

function publicCopyId(alertType: string, settingMenu: string | null | undefined): NotificationCopyId | undefined {
  if (alertType === "child_setting_request") {
    return settingMenu && Object.hasOwn(settingRequestKinds, settingMenu) ? settingRequestKinds[settingMenu] : undefined;
  }
  return Object.hasOwn(publicKinds, alertType) ? publicKinds[alertType] : undefined;
}

/** 공개 요청의 번역 id·이름을 신뢰하지 않고, 이미 권한 확인한 가족의 정본 데이터로 표시 문구만 만든다. */
export async function resolvePublicParentAlertCopy(db: D1Database, input: {
  familyId: string; childUserId: string | null; alertType: string; placeKey?: string | null; sourceEventId?: string | null;
  settingMenu?: string | null;
}): Promise<NotificationCopy | null> {
  const id = publicCopyId(input.alertType, input.settingMenu);
  if (!id || !input.childUserId) return null;
  try {
    const child = await db.prepare("SELECT name FROM family_members WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1")
      .bind(input.familyId, input.childUserId).first<{ name: string }>();
    if (!child) return null;
    const args: Record<string, unknown> = { child: child.name };
    if (id === "arrived" || id === "left") {
      const match = /^registered:(saved_place|academy):(.+)$/.exec(input.placeKey ?? "");
      if (!match) return null;
      const table = match[1] === "saved_place" ? "saved_places" : "academies";
      const place = await db.prepare(`SELECT name FROM ${table} WHERE family_id=? AND id=? LIMIT 1`).bind(input.familyId, match[2]).first<{ name: string }>();
      if (!place) return null;
      args.place = place.name;
    }
    if (id === "scheduleArrived" || id === "scheduleLate") {
      if (!input.sourceEventId) return null;
      const event = await db.prepare("SELECT title FROM events WHERE family_id=? AND id=? LIMIT 1").bind(input.familyId, input.sourceEventId).first<{ title: string }>();
      if (!event) return null;
      args.event = event.title;
    }
    return makeNotificationCopy(id, args);
  } catch {
    // 번역 부가 조회 장애는 안전 알림 자체를 유실시키지 않는다. 원문 경로를 유지한다.
    return null;
  }
}
