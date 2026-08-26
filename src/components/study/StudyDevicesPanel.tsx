import { useState } from "react";
import type { StudyDeviceDto } from "@/lib/api/endpoints/study";
import { createStudyMutationRequest } from "@/lib/api/studyMutationRequest";
import { isApiError } from "@/lib/api/errors";
import { useRevokeStudyDevice } from "@/queries/useStudy";
import { STUDY_COPY_KO } from "./studyCopy.ko";

function formatLastUsed(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return STUDY_COPY_KO.devices.unknownTime;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function StudyDevicesPanel({
  memberId,
  devices,
  canManageLinks,
}: Readonly<{
  memberId: string;
  devices: readonly StudyDeviceDto[];
  canManageLinks: boolean;
}>) {
  const revokeDevice = useRevokeStudyDevice();
  const [confirmingDeviceId, setConfirmingDeviceId] = useState<string | null>(null);
  const permissionDenied = isApiError(revokeDevice.error) && revokeDevice.error.status === 403;

  const confirmRevoke = async (deviceSessionId: string) => {
    try {
      await revokeDevice.mutateAsync({
        request: createStudyMutationRequest(memberId),
        deviceSessionId,
      });
      setConfirmingDeviceId(null);
    } catch {
      // 현재 기기 목록을 그대로 보존하고 안정된 오류 문구만 표시한다.
    }
  };

  return (
    <section className="study-devices" aria-labelledby="study-devices-title">
      <div className="study-devices__heading">
        <h2 id="study-devices-title">{STUDY_COPY_KO.devices.title}</h2>
        <span>{devices.length}{STUDY_COPY_KO.devices.countUnit}</span>
      </div>

      {devices.length === 0 ? (
        <p className="study-devices__empty">{STUDY_COPY_KO.devices.empty}</p>
      ) : (
        <ul className="study-devices__list">
          {devices.map((device, index) => {
            const deviceLabel = `${STUDY_COPY_KO.devices.deviceLabel} ${index + 1}`;
            const confirming = confirmingDeviceId === device.deviceSessionId;
            return (
              <li key={device.deviceSessionId}>
                <div className="study-devices__copy">
                  <strong>{deviceLabel}</strong>
                  <small>{STUDY_COPY_KO.devices.lastUsed} {formatLastUsed(device.lastUsedAt)}</small>
                </div>
                {canManageLinks && !confirming && (
                  <button
                    type="button"
                    className="study-devices__revoke hy-press"
                    onClick={() => setConfirmingDeviceId(device.deviceSessionId)}
                  >
                    {STUDY_COPY_KO.devices.revoke}
                  </button>
                )}
                {canManageLinks && confirming && (
                  <div className="study-devices__confirm" role="group" aria-label={`${deviceLabel} ${STUDY_COPY_KO.devices.confirm}`}>
                    <p>{deviceLabel}{STUDY_COPY_KO.devices.confirmDescription}</p>
                    <button type="button" className="study-devices__cancel hy-press" onClick={() => setConfirmingDeviceId(null)}>
                      {STUDY_COPY_KO.devices.cancel}
                    </button>
                    <button
                      type="button"
                      className="study-devices__confirm-button hy-press"
                      disabled={revokeDevice.isPending}
                      aria-busy={revokeDevice.isPending}
                      onClick={() => void confirmRevoke(device.deviceSessionId)}
                    >
                      {revokeDevice.isPending ? STUDY_COPY_KO.devices.revoking : STUDY_COPY_KO.devices.confirm}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {revokeDevice.isError && (
        <p className="study-devices__error" role="alert">
          {permissionDenied ? STUDY_COPY_KO.devices.primaryOnly : STUDY_COPY_KO.devices.revokeFailed}
        </p>
      )}
      {!canManageLinks && devices.length > 0 && (
        <p className="study-devices__notice">{STUDY_COPY_KO.devices.primaryOnly}</p>
      )}
    </section>
  );
}
