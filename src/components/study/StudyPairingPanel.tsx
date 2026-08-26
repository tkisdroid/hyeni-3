import { useState } from "react";
import { QrCode } from "@/components/ui/QrCode";
import { createStudyMutationRequest } from "@/lib/api/studyMutationRequest";
import { useCreateStudyAttachChallenge } from "@/queries/useStudy";
import { requireSafeStudyAttachQrUrl } from "@/transform/studyClaimContext";
import { STUDY_COPY_KO } from "./studyCopy.ko";

export function StudyPairingPanel({
  memberId,
  childName,
  canManageLinks,
}: Readonly<{
  memberId: string;
  childName: string;
  canManageLinks: boolean;
}>) {
  const createChallenge = useCreateStudyAttachChallenge();
  const [visibleQrUrl, setVisibleQrUrl] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState(false);

  const issueChallenge = async () => {
    setVisibleQrUrl(null);
    setChallengeError(false);
    createChallenge.reset();
    try {
      const response = await createChallenge.mutateAsync(createStudyMutationRequest(memberId));
      setVisibleQrUrl(requireSafeStudyAttachQrUrl(response.challenge.qrUrl));
      createChallenge.reset();
    } catch {
      setVisibleQrUrl(null);
      setChallengeError(true);
    }
  };

  return (
    <section className="study-pairing" aria-labelledby="study-pairing-title">
      <div className="study-pairing__heading">
        <div>
          <h2 id="study-pairing-title">{STUDY_COPY_KO.pairing.title}</h2>
          <p>{childName}{STUDY_COPY_KO.pairing.description}</p>
        </div>
      </div>

      {!canManageLinks ? (
        <p className="study-pairing__notice">{STUDY_COPY_KO.pairing.primaryOnly}</p>
      ) : (
        <>
          <button
            type="button"
            className="study-pairing__issue hy-press"
            disabled={createChallenge.isPending}
            onClick={() => void issueChallenge()}
          >
            {createChallenge.isPending ? STUDY_COPY_KO.pairing.issuing : STUDY_COPY_KO.pairing.issue}
          </button>
          {visibleQrUrl && (
            <div className="study-pairing__qr">
              <QrCode
                value={visibleQrUrl}
                label={STUDY_COPY_KO.pairing.qrLabel}
                fallbackText={STUDY_COPY_KO.pairing.qrFailed}
                failedLabel={STUDY_COPY_KO.pairing.qrFailedLabel}
              />
              <strong>{STUDY_COPY_KO.pairing.expires}</strong>
              <p>{STUDY_COPY_KO.pairing.scanDescription}</p>
            </div>
          )}
        </>
      )}

      {challengeError && (
        <p className="study-pairing__error" role="alert">{STUDY_COPY_KO.pairing.failed}</p>
      )}
    </section>
  );
}
