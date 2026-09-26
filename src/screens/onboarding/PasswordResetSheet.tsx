import { useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { X } from "lucide-react";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { BusyLabel } from "@/components/ui/BusyLabel";
import { confirmPasswordReset, requestPasswordResetCode } from "@/lib/api/endpoints/auth";
import { isApiError } from "@/lib/api/errors";
import { localizeApiError } from "@/i18n/apiError";
import { formatPhoneDisplay } from "@/transform/phoneFormat";
import "./PasswordResetSheet.css";

type Stage = "phone" | "code";

/**
 * 아이디 확인·비밀번호 재설정(휴대폰 인증) 바닥 시트.
 *
 * 2026-09-26 실기기 E2E: 비밀번호를 잊으면 복구 수단이 없어 같은 번호로 새로 가입할 수도 없었다.
 * ① 가입한 휴대폰 번호로 인증번호 받기 → ② 인증번호 + 새 비밀번호 → 서버가 아이디를 돌려주면
 * 로그인 폼에 채워 곧바로 로그인한다(`onReset`). 인증·바꾸기는 사용자 버튼에서만 실행한다.
 */
export function PasswordResetSheet({
  onClose,
  onReset,
}: {
  onClose: () => void;
  onReset: (result: { loginId: string; password: string }) => void;
}) {
  const intl = useIntl();
  const titleId = useId();
  const descriptionId = useId();
  const phoneRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: true,
    onClose,
    initialFocusRef: phoneRef,
    canClose: () => !busy,
  });

  const describe = (cause: unknown): string => {
    // 카카오·Google 로만 가입한 번호는 바꿀 비밀번호가 없다 — 어느 버튼으로 로그인할지 알려 준다.
    if (isApiError(cause) && cause.code === "password_account_required") {
      return intl.formatMessage({ id: "onboarding.passwordReset.socialOnly" });
    }
    return localizeApiError(cause, intl, "formal");
  };

  const sendCode = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await requestPasswordResetCode(phone);
      setStage("code");
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const passwordTooShort = password.length > 0 && password.length < 6;
  const passwordMismatch = confirm.length > 0 && confirm !== password;
  const canConfirm = code.replace(/\D/g, "").length === 6 && password.length >= 6 && confirm === password;

  const resetPassword = async () => {
    if (busy || !canConfirm) return;
    setError(null);
    setBusy(true);
    try {
      const { loginId } = await confirmPasswordReset({ phone, token: code, password });
      onReset({ loginId, password });
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="prs-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <button
        type="button"
        className="prs-scrim"
        tabIndex={-1}
        aria-label={intl.formatMessage({ id: "onboarding.passwordReset.close" })}
        onClick={() => { if (!busy) onClose(); }}
      />
      <div className="prs-sheet">
        <div className="prs-handle" aria-hidden="true" />
        <div className="prs-head">
          <h2 id={titleId} className="prs-title">{intl.formatMessage({ id: "onboarding.passwordReset.title" })}</h2>
          <button
            type="button"
            className="prs-close hy-press"
            aria-label={intl.formatMessage({ id: "onboarding.passwordReset.close" })}
            onClick={onClose}
            disabled={busy}
            aria-busy={busy}
          >
            <X size={20} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <p id={descriptionId} className="prs-desc">
          {intl.formatMessage({
            id: stage === "phone" ? "onboarding.passwordReset.phoneLead" : "onboarding.passwordReset.codeLead",
          }, { phone: formatPhoneDisplay(phone) })}
        </p>

        <form
          className="prs-form"
          onSubmit={(event) => {
            event.preventDefault();
            void (stage === "phone" ? sendCode() : resetPassword());
          }}
        >
          <label className="prs-field">
            <span className="prs-label">{intl.formatMessage({ id: "onboarding.passwordReset.phoneLabel" })}</span>
            <input
              ref={phoneRef}
              className="ob-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="010-0000-0000"
              value={phone}
              readOnly={stage === "code"}
              onChange={(event) => { setPhone(formatPhoneDisplay(event.target.value)); setError(null); }}
            />
          </label>

          {stage === "code" && (
            <>
              <label className="prs-field">
                <span className="prs-label">{intl.formatMessage({ id: "onboarding.passwordReset.codeLabel" })}</span>
                <input
                  className="ob-input ob-input--otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                />
              </label>
              <label className="prs-field">
                <span className="prs-label">{intl.formatMessage({ id: "onboarding.passwordReset.newPasswordLabel" })}</span>
                <input
                  className="ob-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={intl.formatMessage({ id: "onboarding.passwordReset.newPasswordPlaceholder" })}
                  aria-invalid={passwordTooShort}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setError(null); }}
                />
              </label>
              <label className="prs-field">
                <span className="prs-label">{intl.formatMessage({ id: "onboarding.passwordReset.confirmLabel" })}</span>
                <input
                  className="ob-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={intl.formatMessage({ id: "onboarding.passwordReset.confirmPlaceholder" })}
                  aria-invalid={passwordMismatch}
                  value={confirm}
                  onChange={(event) => { setConfirm(event.target.value); setError(null); }}
                />
              </label>
              {(passwordTooShort || passwordMismatch) && (
                <p className="ob-field-error" role="alert">
                  {intl.formatMessage({
                    id: passwordTooShort ? "onboarding.passwordReset.tooShort" : "onboarding.passwordReset.mismatch",
                  })}
                </p>
              )}
            </>
          )}

          {error && <p className="prs-error" role="alert">{error}</p>}

          <button
            type="submit"
            className="ob-loginbtn prs-submit hy-press hy-busy-quiet"
            disabled={busy || (stage === "phone" ? phone.replace(/\D/g, "").length < 10 : !canConfirm)}
            aria-busy={busy}
          >
            <BusyLabel
              busy={busy}
              idle={intl.formatMessage({
                id: stage === "phone" ? "onboarding.passwordReset.sendCode" : "onboarding.passwordReset.submit",
              })}
              pending={intl.formatMessage({ id: "onboarding.passwordReset.pending" })}
            />
          </button>
          {stage === "code" && (
            <button
              type="button"
              className="ob-link prs-resend"
              disabled={busy}
              aria-busy={busy}
              onClick={() => { setCode(""); void sendCode(); }}
            >
              {intl.formatMessage({ id: "onboarding.passwordReset.resend" })}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
