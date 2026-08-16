import { createIntl, createIntlCache, type IntlShape } from "react-intl";
import coreMessages from "./generated/catalogs/ko/core.ts";
import notificationsMessages from "./generated/catalogs/ko/notifications.ts";
import parentMessages from "./generated/catalogs/ko/parent.ts";
import sharedMessages from "./generated/catalogs/ko/shared.ts";

const cache = createIntlCache();

export const defaultKoreanIntl = createIntl({
  locale: "ko",
  messages: { ...coreMessages, ...notificationsMessages, ...parentMessages, ...sharedMessages },
}, cache);

export function withDefaultIntl(intl?: IntlShape): IntlShape {
  return intl ?? defaultKoreanIntl;
}
