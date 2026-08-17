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

export function LanguageSelector({ tone }: { tone: "formal" | "child" }) {
  const { locale, setLocale } = useLocale();
  const intl = useIntl();
  const labelId = useId();
  const descriptionId = useId();
  const copy = copyIds[tone];

  return (
    <fieldset
      className="hy-language"
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
    >
      <legend id={labelId} className="hy-language__label">
        {intl.formatMessage({ id: copy.label })}
      </legend>
      <p id={descriptionId} className="hy-language__description">
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
