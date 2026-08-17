import { useId, useRef, useState } from "react";
import { BookOpenCheck, FileText, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { APP_VERSION } from "@/config/version";
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
} from "@/lib/api/endpoints/account";
import { openExternal } from "@/lib/native/browser";
import "./TeacherReleaseGate.css";

type BusyAction = "logout" | "delete" | null;

export function TeacherReleaseGate() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const { logout, deleteAccount } = useAuth();
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: confirmDelete,
    onClose: () => setConfirmDelete(false),
    initialFocusRef: deleteCancelRef,
    canClose: () => !busyAction,
  });

  const handleLogout = async () => {
    if (busyAction) return;
    setBusyAction("logout");
    try {
      await logout();
      navigate("/onboarding", { replace: true });
    } catch {
      show(intl.formatMessage({ id: "shared.teacherReleaseGate.error.logout" }), "⚠️");
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (busyAction) return;
    setBusyAction("delete");
    try {
      await deleteAccount();
      show(intl.formatMessage({ id: "shared.teacherReleaseGate.delete.success" }), "🗑️");
      navigate("/onboarding", { replace: true });
    } catch {
      show(intl.formatMessage({ id: "shared.teacherReleaseGate.delete.error" }), "⚠️");
      setBusyAction(null);
    }
  };

  const openLegal = async (url: string) => {
    try {
      await openExternal(url);
    } catch {
      show(intl.formatMessage({ id: "shared.teacherReleaseGate.legal.error" }), "⚠️");
    }
  };

  return (
    <div className="trg-screen">
      <section className="trg-card" aria-labelledby="teacher-release-title">
        <div className="trg-icon" aria-hidden="true">
          <BookOpenCheck size={34} strokeWidth={2.1} />
        </div>
        <p className="trg-eyebrow">
          {intl.formatMessage(
            { id: "shared.teacherReleaseGate.eyebrow" },
            { version: APP_VERSION },
          )}
        </p>
        <h1 id="teacher-release-title">
          {intl.formatMessage({ id: "shared.teacherReleaseGate.title" })}
        </h1>
        <p className="trg-copy">
          {intl.formatMessage({ id: "shared.teacherReleaseGate.description" })}
        </p>

        <div className="trg-notice hy-explain">
          <ShieldCheck size={20} strokeWidth={2.2} aria-hidden="true" />
          <span>{intl.formatMessage({ id: "shared.teacherReleaseGate.notice" })}</span>
        </div>

        <div className="trg-actions">
          <button
            type="button"
            className="trg-primary hy-press"
            onClick={() => void handleLogout()}
            disabled={busyAction !== null}
            aria-busy={busyAction === "logout"}
          >
            <LogOut size={19} strokeWidth={2.2} aria-hidden="true" />
            {busyAction === "logout"
              ? intl.formatMessage({ id: "shared.teacherReleaseGate.logout.pending" })
              : intl.formatMessage({ id: "shared.teacherReleaseGate.logout.action" })}
          </button>
          <button
            type="button"
            className="trg-danger hy-press"
            onClick={() => setConfirmDelete(true)}
            disabled={busyAction !== null}
            data-progress-owner="account-action"
          >
            <Trash2 size={18} strokeWidth={2.2} aria-hidden="true" />
            {intl.formatMessage({ id: "shared.teacherReleaseGate.delete.action" })}
          </button>
        </div>

        <nav
          className="trg-legal"
          aria-label={intl.formatMessage({ id: "shared.teacherReleaseGate.legal.label" })}
        >
          <button type="button" onClick={() => void openLegal(TERMS_OF_SERVICE_URL)}>
            <FileText size={16} aria-hidden="true" />
            {intl.formatMessage({ id: "shared.teacherReleaseGate.legal.terms" })}
          </button>
          <button type="button" onClick={() => void openLegal(PRIVACY_POLICY_URL)}>
            <FileText size={16} aria-hidden="true" />
            {intl.formatMessage({ id: "shared.teacherReleaseGate.legal.privacy" })}
          </button>
        </nav>
      </section>

      {confirmDelete && (
        <div
          ref={deleteDialogRef}
          className="trg-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={deleteTitleId}
          aria-describedby={deleteDescriptionId}
        >
          <button
            type="button"
            className="trg-dialog__scrim"
            tabIndex={-1}
            aria-label={intl.formatMessage({ id: "shared.teacherReleaseGate.delete.close" })}
            onClick={() => !busyAction && setConfirmDelete(false)}
          />
          <div className="trg-dialog__card">
            <h2 id={deleteTitleId}>
              {intl.formatMessage({ id: "shared.teacherReleaseGate.delete.dialogTitle" })}
            </h2>
            <p id={deleteDescriptionId}>
              {intl.formatMessage({ id: "shared.teacherReleaseGate.delete.dialogDescription" })}
            </p>
            <div className="trg-dialog__actions">
              <button
                ref={deleteCancelRef}
                type="button"
                className="trg-dialog__cancel hy-press"
                onClick={() => setConfirmDelete(false)}
                disabled={busyAction !== null}
                data-progress-owner="delete-action"
              >
                {intl.formatMessage({ id: "shared.teacherReleaseGate.delete.cancel" })}
              </button>
              <button
                type="button"
                className="trg-dialog__delete hy-press"
                onClick={() => void handleDelete()}
                disabled={busyAction !== null}
                aria-busy={busyAction === "delete"}
              >
                {busyAction === "delete"
                  ? intl.formatMessage({ id: "shared.teacherReleaseGate.delete.pending" })
                  : intl.formatMessage({ id: "shared.teacherReleaseGate.delete.confirm" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
