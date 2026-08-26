import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { StudyChildDto, StudyClaimResponse } from "@/lib/api/endpoints/study";
import { createStudyMutationRequest } from "@/lib/api/studyMutationRequest";
import { isApiError } from "@/lib/api/errors";
import { useClaimStudyProfile } from "@/queries/useStudy";
import type { ActiveStudyChild } from "@/transform/studyManagementView";
import {
  clearPendingStudyClaim,
  pendingStudyClaimDestination,
  restoreStudyClaim,
} from "@/transform/studyClaimContext";
import { STUDY_COPY_KO } from "./studyCopy.ko";

type ClaimState =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "success"; result: StudyClaimResponse["result"] }>
  | Readonly<{ kind: "expired" }>
  | Readonly<{ kind: "reused" }>
  | Readonly<{ kind: "primary-only" }>
  | Readonly<{ kind: "failed" }>;

function claimAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return pendingStudyClaimDestination(
      "parent",
      window.sessionStorage,
      { now: () => Date.now() },
    ) !== null;
  } catch {
    return false;
  }
}

function clearStoredClaim(): void {
  if (typeof window === "undefined") return;
  try { clearPendingStudyClaim(window.sessionStorage); } catch { /* 저장소 접근 불가 */ }
}

export function StudyClaimGate({
  children,
  studyChildren,
}: Readonly<{
  children: readonly ActiveStudyChild[];
  studyChildren: readonly StudyChildDto[];
}>) {
  const navigate = useNavigate();
  const claimProfile = useClaimStudyProfile();
  const [targetMemberId, setTargetMemberId] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>(() => (
    claimAvailable() ? { kind: "ready" } : { kind: "reused" }
  ));

  useEffect(() => {
    if (children.length === 1) setTargetMemberId(children[0].memberId);
    else setTargetMemberId((current) => (
      current && children.some((child) => child.memberId === current) ? current : null
    ));
  }, [children]);

  const selectedFamilyChild = targetMemberId
    ? children.find((child) => child.memberId === targetMemberId)
    : undefined;
  const selectedStudyChild = targetMemberId
    ? studyChildren.find((child) => child.memberId === targetMemberId)
    : undefined;

  const cancelClaim = () => {
    clearStoredClaim();
    navigate("/study-management", { replace: true });
  };

  const consumeClaim = async () => {
    if (!targetMemberId || !selectedStudyChild) return;
    if (!selectedStudyChild.canManageLinks) {
      clearStoredClaim();
      setClaimState({ kind: "primary-only" });
      return;
    }
    try {
      const result = await claimProfile.mutateAsync({
        request: createStudyMutationRequest(targetMemberId),
        claim: restoreStudyClaim(window.sessionStorage, { now: () => Date.now() }),
      });
      setClaimState({ kind: "success", result: result.result });
    } catch (error) {
      clearStoredClaim();
      if (error instanceof Error && error.message === "study_claim_expired") {
        setClaimState({ kind: "expired" });
      } else if (error instanceof Error && error.message === "study_claim_already_consumed") {
        setClaimState({ kind: "reused" });
      } else if (isApiError(error) && error.status === 403) {
        setClaimState({ kind: "primary-only" });
      } else {
        setClaimState({ kind: "failed" });
      }
    } finally {
      claimProfile.reset();
    }
  };

  if (claimState.kind === "success") {
    return (
      <section className="study-claim" aria-live="polite">
        <h2>{STUDY_COPY_KO.claim.successTitle}</h2>
        <p>{STUDY_COPY_KO.claim.successDescription}</p>
        <p>{STUDY_COPY_KO.claim.preserved} {claimState.result.preservedAttemptCount}{STUDY_COPY_KO.claim.problemUnit}</p>
        <button type="button" className="study-claim__primary hy-press" onClick={() => navigate("/study-management", { replace: true })}>
          {STUDY_COPY_KO.claim.viewReport}
        </button>
      </section>
    );
  }

  if (claimState.kind !== "ready") {
    const message = claimState.kind === "primary-only"
      ? STUDY_COPY_KO.claim.primaryOnly
      : claimState.kind === "expired"
        ? STUDY_COPY_KO.claim.expired
        : claimState.kind === "reused"
          ? STUDY_COPY_KO.claim.reused
        : STUDY_COPY_KO.claim.failed;
    return (
      <section className="study-claim" role="alert">
        <h2>{STUDY_COPY_KO.claim.unavailableTitle}</h2>
        <p>{message}</p>
        <button type="button" className="study-claim__secondary hy-press" onClick={cancelClaim}>
          {STUDY_COPY_KO.claim.back}
        </button>
      </section>
    );
  }

  return (
    <section className="study-claim" aria-labelledby="study-claim-title">
      <h2 id="study-claim-title">{STUDY_COPY_KO.claim.title}</h2>
      <p>{children.length === 1 ? STUDY_COPY_KO.claim.confirmOne : STUDY_COPY_KO.claim.chooseChild}</p>

      {children.length > 1 && (
        <div className="study-claim__children" role="radiogroup" aria-label={STUDY_COPY_KO.claim.chooseLabel}>
          {children.map((child) => (
            <button
              type="button"
              role="radio"
              aria-checked={targetMemberId === child.memberId}
              className="study-claim__child hy-press"
              key={child.memberId}
              onClick={() => setTargetMemberId(child.memberId)}
            >
              {child.displayName}
            </button>
          ))}
        </div>
      )}

      {selectedFamilyChild && (
        <p className="study-claim__target">
          <strong>{selectedFamilyChild.displayName}</strong>{STUDY_COPY_KO.claim.targetSuffix}
        </p>
      )}

      <div className="study-claim__actions">
        <button type="button" className="study-claim__secondary hy-press" onClick={cancelClaim}>
          {STUDY_COPY_KO.claim.cancel}
        </button>
        <button
          type="button"
          className="study-claim__primary hy-press"
          disabled={!selectedStudyChild || claimProfile.isPending}
          aria-busy={claimProfile.isPending}
          onClick={() => void consumeClaim()}
        >
          {claimProfile.isPending ? STUDY_COPY_KO.claim.connecting : STUDY_COPY_KO.claim.connect}
        </button>
      </div>
    </section>
  );
}
