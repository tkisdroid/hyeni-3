import { useId, useRef, useState } from "react";
import { BookOpenCheck, FileText, LogOut, ShieldCheck, Trash2 } from "lucide-react";
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
      show("로그아웃하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.", "⚠️");
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (busyAction) return;
    setBusyAction("delete");
    try {
      await deleteAccount();
      show("선생님 계정이 삭제되었어요.", "🗑️");
      navigate("/onboarding", { replace: true });
    } catch {
      show("계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.", "⚠️");
      setBusyAction(null);
    }
  };

  const openLegal = async (url: string) => {
    try {
      await openExternal(url);
    } catch {
      show("문서를 열 수 없어요. 네트워크와 기본 브라우저를 확인해 주세요.", "⚠️");
    }
  };

  return (
    <div className="trg-screen">
      <section className="trg-card" aria-labelledby="teacher-release-title">
        <div className="trg-icon" aria-hidden="true">
          <BookOpenCheck size={34} strokeWidth={2.1} />
        </div>
        <p className="trg-eyebrow">혜니캘린더 v{APP_VERSION}</p>
        <h1 id="teacher-release-title">선생님 모드는 준비 중이에요</h1>
        <p className="trg-copy">
          현재 출시 버전은 보호자와 아이 기능을 먼저 제공합니다. 반·학생 정보의 심사와
          개인정보 보호 준비가 끝나면 선생님 기능을 안전하게 다시 열겠습니다.
        </p>

        <div className="trg-notice hy-explain">
          <ShieldCheck size={20} strokeWidth={2.2} aria-hidden="true" />
          <span>기존 계정은 유지되며, 원하시면 아래에서 로그아웃하거나 탈퇴할 수 있습니다.</span>
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
            {busyAction === "logout" ? "로그아웃 중…" : "로그아웃하고 다른 계정으로 시작"}
          </button>
          <button
            type="button"
            className="trg-danger hy-press"
            onClick={() => setConfirmDelete(true)}
            disabled={busyAction !== null}
            data-progress-owner="account-action"
          >
            <Trash2 size={18} strokeWidth={2.2} aria-hidden="true" />
            회원 탈퇴
          </button>
        </div>

        <nav className="trg-legal" aria-label="법적 문서">
          <button type="button" onClick={() => void openLegal(TERMS_OF_SERVICE_URL)}>
            <FileText size={16} aria-hidden="true" />
            이용약관
          </button>
          <button type="button" onClick={() => void openLegal(PRIVACY_POLICY_URL)}>
            <FileText size={16} aria-hidden="true" />
            개인정보 처리방침
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
            aria-label="회원 탈퇴 확인 닫기"
            onClick={() => !busyAction && setConfirmDelete(false)}
          />
          <div className="trg-dialog__card">
            <h2 id={deleteTitleId}>선생님 계정을 삭제할까요?</h2>
            <p id={deleteDescriptionId}>내 계정과 내가 만든 반·학생 연결 정보는 삭제되며 복구할 수 없습니다.</p>
            <div className="trg-dialog__actions">
              <button
                ref={deleteCancelRef}
                type="button"
                className="trg-dialog__cancel hy-press"
                onClick={() => setConfirmDelete(false)}
                disabled={busyAction !== null}
                data-progress-owner="delete-action"
              >
                취소
              </button>
              <button
                type="button"
                className="trg-dialog__delete hy-press"
                onClick={() => void handleDelete()}
                disabled={busyAction !== null}
                aria-busy={busyAction === "delete"}
              >
                {busyAction === "delete" ? "삭제 중…" : "탈퇴하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
