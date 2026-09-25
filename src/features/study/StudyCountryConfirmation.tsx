import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import "./study-access.css";

type Props = Readonly<{
  suggestedCountry: string | null;
  initialCountry?: string | null;
  busy?: boolean;
  confirmed?: boolean;
  onCountryChange?: (country: string) => void;
  onConfirm: (country: string) => void | Promise<void>;
}>;

/** "KR" → 현재 언어의 국가 이름("대한민국"). 브라우저가 모르면 코드 그대로. */
export function studyCountryDisplayName(code: string | null, locale: string): string | null {
  if (!code || !/^[A-Z]{2}$/u.test(code)) return null;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function normalizeSuggestedStudyCountry(value: string | null | undefined): string | null {
  const country = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/u.test(country) && country !== "ZZ" ? country : null;
}

export function StudyCountryConfirmation({
  suggestedCountry,
  initialCountry,
  busy = false,
  confirmed = false,
  onCountryChange,
  onConfirm,
}: Props) {
  const intl = useIntl();
  const suggestion = normalizeSuggestedStudyCountry(suggestedCountry);
  const [country, setCountry] = useState(() => normalizeSuggestedStudyCountry(initialCountry) ?? suggestion ?? "KR");

  useEffect(() => {
    if (!confirmed && suggestion) setCountry(suggestion);
  }, [confirmed, suggestion]);

  const changeCountry = (value: string) => {
    const normalized = value.replace(/[^A-Za-z]/gu, "").slice(0, 2).toUpperCase();
    setCountry(normalized);
    onCountryChange?.(normalized);
  };

  return (
    <section className="study-country-card" aria-labelledby="study-country-title">
      <h2 id="study-country-title">{intl.formatMessage({ id: "study.country.title" })}</h2>
      <p>
        {intl.formatMessage(
          { id: "study.country.description" },
          { country: studyCountryDisplayName(suggestion, intl.locale) ?? intl.formatMessage({ id: "study.country.unknown" }) },
        )}
      </p>
      <label htmlFor="study-service-country">{intl.formatMessage({ id: "study.country.inputLabel" })}</label>
      <input
        id="study-service-country"
        className="study-country-input"
        value={country}
        inputMode="text"
        autoCapitalize="characters"
        maxLength={2}
        pattern="[A-Za-z]{2}"
        disabled={busy || confirmed}
        onChange={(event) => changeCountry(event.target.value)}
        aria-describedby="study-country-help"
      />
      {/* 두 글자 코드만으로는 어느 나라인지 알기 어렵다 — 입력한 코드의 국가 이름을 바로 보여 준다. */}
      <output htmlFor="study-service-country" aria-live="polite">
        {studyCountryDisplayName(country, intl.locale)}
      </output>
      <small id="study-country-help">{intl.formatMessage({ id: "study.country.inputHelp" })}</small>
      <button
        type="button"
        className="study-access-action"
        disabled={busy || confirmed || !/^[A-Z]{2}$/u.test(country)}
        aria-busy={busy}
        onClick={() => void onConfirm(country)}
      >
        {intl.formatMessage({
          id: confirmed ? "study.country.confirmed" : busy ? "study.country.confirming" : "study.country.confirm",
        })}
      </button>
    </section>
  );
}
