import { createIntl, createIntlCache, type IntlShape } from "react-intl";
import legacyKoreanMessages from "./generated/legacyKoreanMessages.ts";

const cache = createIntlCache();

export const defaultKoreanIntl = createIntl({
  locale: "ko",
  messages: legacyKoreanMessages,
}, cache);

export function withDefaultIntl(intl?: IntlShape): IntlShape {
  return intl ?? defaultKoreanIntl;
}
