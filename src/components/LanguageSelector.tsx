import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
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
 * 기본형 = 피커. "Language" 트리거 알약을 누르면 1열 목록이 펼쳐진다.
 * compact = 이미 라벨이 있는 설정 행 안에 펼쳐 쓰는 형태(칩 그리드 유지).
 * 접힌 목록은 visibility 로 보조기술·탭 순서에서 함께 감긴다.
 */
export function LanguageSelector({
  tone,
  compact = false,
  collapseOthers = false,
}: {
  tone: "formal" | "child";
  compact?: boolean;
  collapseOthers?: boolean;
}) {
  const { locale, setLocale } = useLocale();
  const intl = useIntl();
  const labelId = useId();
  const descriptionId = useId();
  const panelId = useId();
  const optionsId = useId();
  const copy = copyIds[tone];
  const textClass = compact || collapseOthers ? " hy-language__text--quiet" : "";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLFieldSetElement | null>(null);

  // 피커는 임시 팝업이다 — 바깥 탭·Escape 로 닫고 포커스 함정은 두지 않는다.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        rootRef.current
        && event.target instanceof Node
        && !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentEntry = localeEntries.find((entry) => entry.code === locale);
  const visibleEntries = collapseOthers
    ? localeEntries.filter((entry) => entry.code !== locale)
    : localeEntries;

  return (
    <fieldset
      ref={!compact && !collapseOthers ? rootRef : undefined}
      className={[
        "hy-language",
        compact ? "hy-language--compact" : "",
        !compact && !collapseOthers ? "hy-language--picker" : "",
        collapseOthers ? "hy-language--collapse-others" : "",
      ].filter(Boolean).join(" ")}
      data-open={open ? "true" : "false"}
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
{compact ? (
        /* 설정 행 안 — 행 제목이 이미 있으므로 칩 그리드만 남긴다. */
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
      ) : collapseOthers ? (
        <>
          {/* 설정 행 토글 — 현재 언어 알약을 누르면 나머지 언어 목록이 펼쳐진다. */}
          <button
            type="button"
            role="radio"
            aria-checked="true"
            aria-expanded={open}
            aria-controls={optionsId}
            className="hy-language__current hy-language__toggle hy-press"
            lang={currentEntry?.code ?? locale}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{currentEntry?.nativeName ?? locale}</span>
            <span className="hy-language__toggle-label">{intl.formatMessage({ id: copy.label })}</span>
            <ChevronDown
              className={open ? "hy-language__chevron hy-language__chevron--open" : "hy-language__chevron"}
              size={20}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </button>
          <div className="hy-language__collapse" id={optionsId} data-open={open ? "true" : "false"}>
            <div className="hy-language__panel">
              <div className="hy-language__options hy-language__options--list">
                {visibleEntries.map((entry) => (
                  <button
                    key={entry.code}
                    type="button"
                    role="radio"
                    aria-checked={locale === entry.code}
                    className="hy-language__option hy-press"
                    lang={entry.code}
                    onClick={() => {
                      setOpen(false);
                      void setLocale(entry.code);
                    }}
                  >
                    <span className="hy-language__option-name">{entry.nativeName}</span>
                    <span className="hy-language__option-check" aria-hidden="true">
                      {locale === entry.code && <Check size={16} strokeWidth={2.4} />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* 첫 화면 — 브랜드 중립어 "Language" 를 그대로 보여준다(번역하지 않는 고정 표기). */}
          <button
            type="button"
            className="hy-language__trigger hy-press"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            <Globe size={18} strokeWidth={2.2} aria-hidden="true" />
            <span className="hy-language__trigger-word">Language</span>
            <span className="hy-language__trigger-value" lang={locale}>
              {currentEntry?.nativeName ?? locale}
            </span>
            <ChevronDown
              className={open ? "hy-language__chevron hy-language__chevron--open" : "hy-language__chevron"}
              size={18}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </button>

          {/* 접힘 애니메이션은 grid-template-rows 0fr→1fr — 높이를 px 로 몰아넣지 않는다. */}
          <div className="hy-language__collapse" id={panelId}>
            <div className="hy-language__panel">
              <div className="hy-language__options hy-language__options--list">
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
                    <span className="hy-language__option-name">{entry.nativeName}</span>
                    <span className="hy-language__option-check" aria-hidden="true">
                      {locale === entry.code && <Check size={16} strokeWidth={2.4} />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </fieldset>
  );
}
