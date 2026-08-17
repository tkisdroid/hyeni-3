import { useId } from "react";
import { useIntl } from "react-intl";
import { useLocale } from "@/i18n/useLocale";
import type { SupportedLocale } from "@/i18n/locale";
import "./LanguageSelector.css";

const localeEntries = [
  { code: "ko", nativeName: "한국어" },
  { code: "en", nativeName: "English" },
  { code: "ja", nativeName: "日本語" },
  { code: "zh-CN", nativeName: "简体中文" },
  { code: "zh-TW", nativeName: "繁體中文" },
  { code: "vi", nativeName: "Tiếng Việt" },
  { code: "th", nativeName: "ไทย" },
  { code: "id", nativeName: "Bahasa Indonesia" },
  { code: "ms", nativeName: "Bahasa Melayu" },
  { code: "fil", nativeName: "Filipino" },
] as const satisfies readonly { code: SupportedLocale; nativeName: string }[];

const copyIds = {
  formal: {
    label: "core.language.formal.label",
    description: "core.language.formal.description",
  },
  child: {
    label: "core.language.child.label",
    description: "core.language.child.description",
  },
} as const;

/** 현재 언어의 자칭 명칭(설정 행에 지금 값을 보여줄 때 쓴다). */
export function languageNativeName(locale: SupportedLocale): string {
  return localeEntries.find((entry) => entry.code === locale)?.nativeName ?? locale;
}

/**
 * compact = 이미 라벨이 있는 설정 행 안에 펼쳐 쓰는 형태.
 * 제목·설명을 화면에서 감춰 같은 말을 두 번 보여주지 않고(보조기술에는 그대로 남긴다) 선택 칩만 보여준다.
 */
export function LanguageSelector({ tone, compact = false }: { tone: "formal" | "child"; compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const intl = useIntl();
  const labelId = useId();
  const descriptionId = useId();
  const copy = copyIds[tone];
  const textClass = compact ? " hy-language__text--quiet" : "";

  return (
    <fieldset
      className={compact ? "hy-language hy-language--compact" : "hy-language"}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
    >
      <legend id={labelId} className={`hy-language__label${textClass}`}>
        {intl.formatMessage({ id: copy.label })}
      </legend>
      <p id={descriptionId} className={`hy-language__description${textClass}`}>
        {intl.formatMessage({ id: copy.description })}
      </p>
      <div className="hy-language__options">
        {localeEntries.map((entry) => (
          <button
            key={entry.code}
            type="button"
            role="radio"
            aria-checked={locale === entry.code}
            className="hy-language__option hy-press"
            lang={entry.code}
            onClick={() => void setLocale(entry.code)}
          >
            {entry.nativeName}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
