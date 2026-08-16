import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

/**
 * 오늘 화면잠금 해제 횟수 라벨.
 *
 * 네이티브가 KEYGUARD_HIDDEN(잠금 실제 해제)만 세서 보낸다 — 알림으로 화면이
 * 켜지기만 한 것은 포함되지 않는다("아이가 직접 열어 본 횟수", TK 2026-07-11).
 * 권한 없음·미보고(null·undefined) 또는 잘못된 값은 사용자 요청에 따라 "0회".
 */
export function unlockCountLabel(
  count: number | null | undefined,
  providedIntl?: IntlShape,
): string {
  const intl = withDefaultIntl(providedIntl);
  const safeCount = typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0;
  return intl.formatMessage({ id: "parent.device.unlockCount" }, { count: safeCount });
}
