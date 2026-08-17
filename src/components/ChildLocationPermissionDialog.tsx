import { useEffect, useId, useRef, useState } from "react";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import {
  requestBackgroundLocationPermission,
  requestForegroundLocationPermission,
} from "@/lib/native/permissions";
import {
  advanceLocationPermissionStage,
  type LocationPermissionStage,
} from "@/transform/locationPermissionFlow";
import "./ChildLocationPermissionDialog.css";

type CopyMode = "formal" | "child";

interface ChildLocationPermissionDialogProps {
  open: boolean;
  copyMode: CopyMode;
  onDismiss: () => void;
  onPermissionGranted: () => void | Promise<void>;
}

const FORMAL_COPY = {
  disclosureEyebrow: "아이 위치 공유 안내",
  disclosureTitle: "백그라운드 위치를 사용해요",
  disclosureBody: [
    "혜니캘린더는 아이가 앱을 닫거나 사용하지 않을 때도 위치를 수집해 연결된 보호자에게 공유합니다.",
    "위치는 실시간 위치·오늘 경로와 집·학교·학원 도착·출발, 일정 미도착, 위험구역 알림에 사용됩니다.",
    "위치 수집 중에는 Android의 지속 알림이 표시되며, 아이 기기의 위치 설정에서 언제든지 권한을 끌 수 있습니다.",
  ],
  backgroundEyebrow: "마지막 위치 설정",
  backgroundTitle: "위치를 ‘항상 허용’으로 선택해 주세요",
  backgroundBody: [
    "다음 Android 위치 권한 화면에서 ‘항상 허용’을 선택해야 앱을 닫은 뒤에도 도착·출발과 위험구역 알림이 이어집니다.",
    "허용하지 않아도 앱은 사용할 수 있으며, 아이 설정에서 나중에 다시 켤 수 있습니다.",
  ],
  deniedEyebrow: "위치 권한이 필요해요",
  deniedTitle: "아직 위치 권한이 꺼져 있어요",
  unsupportedTitle: "이 기기에서는 지원하지 않아요",
  deniedBody: "권한 없이 시작하면 보호자에게 현재 위치와 도착·출발 알림이 전달되지 않습니다.",
  unsupportedBody: "아이의 백그라운드 위치 공유는 Android 앱에서 사용할 수 있습니다.",
  deniedFollowup: "앱은 계속 사용할 수 있고, 아이 설정에서 언제든지 다시 설정할 수 있습니다.",
  later: "나중에",
  continue: "동의하고 계속",
  openSettings: "‘항상 허용’ 설정 열기",
  withoutPermission: "권한 없이 시작",
  retry: "다시 설정",
  checking: "권한 확인 중…",
  opening: "설정 확인 중…",
} as const;

const CHILD_COPY = {
  disclosureEyebrow: "내 위치 공유 안내",
  disclosureTitle: "백그라운드 위치를 사용해",
  disclosureBody: [
    "혜니캘린더는 네가 앱을 닫거나 사용하지 않을 때도 위치를 수집해서 연결된 보호자에게 보내.",
    "위치는 실시간 위치·오늘 경로와 집·학교·학원 도착·출발, 일정 미도착, 위험구역 알림에 사용돼.",
    "위치를 보내는 동안에는 Android 알림이 계속 보여. 내 위치 설정에서 언제든지 권한을 끌 수 있어.",
  ],
  backgroundEyebrow: "마지막 위치 설정",
  backgroundTitle: "위치를 ‘항상 허용’으로 골라 줘",
  backgroundBody: [
    "다음 Android 위치 권한 화면에서 ‘항상 허용’을 골라야 앱을 닫은 뒤에도 도착·출발과 위험구역 알림을 보낼 수 있어.",
    "허용하지 않아도 앱은 쓸 수 있고, 내 위치에서 나중에 다시 켤 수 있어.",
  ],
  deniedEyebrow: "위치 권한이 필요해",
  deniedTitle: "아직 위치 권한이 꺼져 있어",
  unsupportedTitle: "이 기기에서는 지원하지 않아",
  deniedBody: "권한 없이 시작하면 엄마·아빠에게 지금 위치와 도착·출발 알림을 보낼 수 없어.",
  unsupportedBody: "백그라운드 위치 공유는 Android 앱에서 쓸 수 있어.",
  deniedFollowup: "앱은 계속 쓸 수 있고, 내 위치에서 언제든지 다시 설정할 수 있어.",
  later: "나중에",
  continue: "동의하고 계속",
  openSettings: "‘항상 허용’ 설정 열기",
  withoutPermission: "권한 없이 계속",
  retry: "다시 설정",
  checking: "권한 확인 중…",
  opening: "설정 확인 중…",
} as const;

export function ChildLocationPermissionDialog({
  open,
  copyMode,
  onDismiss,
  onPermissionGranted,
}: ChildLocationPermissionDialogProps) {
  const copy = copyMode === "child" ? CHILD_COPY : FORMAL_COPY;
  const [stage, setStage] = useState<LocationPermissionStage>("closed");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [locationUnsupported, setLocationUnsupported] = useState(false);
  const previousOpenRef = useRef(false);
  const previousStageRef = useRef(stage);
  const titleId = useId();
  const descriptionId = useId();
  const stageTitleRef = useRef<HTMLHeadingElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);

  const dismiss = () => {
    if (permissionBusy) return;
    setStage("closed");
    onDismiss();
  };

  const dialogRef = useDialogFocusLifecycle<HTMLElement>({
    open: open && stage !== "closed",
    onClose: dismiss,
    initialFocusRef: secondaryRef,
    canClose: () => !permissionBusy,
  });

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (open && !wasOpen) {
      setLocationUnsupported(false);
      setStage(advanceLocationPermissionStage("closed", { type: "open" }));
    } else if (!open && wasOpen) {
      setStage("closed");
    }
  }, [open]);

  useEffect(() => {
    const previousStage = previousStageRef.current;
    previousStageRef.current = stage;
    if (previousStage === "closed" || stage === "closed") return;
    stageTitleRef.current?.focus({ preventScroll: true });
  }, [stage]);

  const requestForeground = async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    try {
      const result = await requestForegroundLocationPermission();
      setLocationUnsupported(!result.supported);
      setStage(advanceLocationPermissionStage(stage, {
        type: "foregroundResult",
        granted: result.granted,
        supported: result.supported,
      }));
    } catch {
      setLocationUnsupported(false);
      setStage("foregroundDenied");
    } finally {
      setPermissionBusy(false);
    }
  };

  const requestBackground = async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    try {
      const result = await requestBackgroundLocationPermission();
      setLocationUnsupported(!result.supported);
      const nextStage = advanceLocationPermissionStage(stage, {
        type: "backgroundResult",
        granted: result.granted,
        supported: result.supported,
      });
      setStage(nextStage);
      if (result.granted) await onPermissionGranted();
    } catch {
      setLocationUnsupported(false);
      setStage("backgroundDenied");
    } finally {
      setPermissionBusy(false);
    }
  };

  const retry = () => {
    setLocationUnsupported(false);
    setStage(advanceLocationPermissionStage(stage, { type: "retry" }));
  };

  if (!open || stage === "closed") return null;

  return (
    <div className="clp-overlay">
      <section
        ref={dialogRef}
        className="clp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        {stage === "disclosure" && (
          <>
            <span className="clp-dialog__eyebrow">{copy.disclosureEyebrow}</span>
            <h2 ref={stageTitleRef} id={titleId} tabIndex={-1}>{copy.disclosureTitle}</h2>
            <div id={descriptionId} className="clp-dialog__copy">
              {copy.disclosureBody.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            <div className="clp-dialog__actions">
              <button ref={secondaryRef} type="button" className="clp-secondary hy-press" onClick={dismiss} disabled={permissionBusy} data-progress-owner="permission-request">
                {copy.later}
              </button>
              <button type="button" className="clp-primary hy-press" onClick={() => void requestForeground()} disabled={permissionBusy} aria-busy={permissionBusy}>
                {permissionBusy ? copy.checking : copy.continue}
              </button>
            </div>
          </>
        )}

        {stage === "backgroundEducation" && (
          <>
            <span className="clp-dialog__eyebrow">{copy.backgroundEyebrow}</span>
            <h2 ref={stageTitleRef} id={titleId} tabIndex={-1}>{copy.backgroundTitle}</h2>
            <div id={descriptionId} className="clp-dialog__copy">
              {copy.backgroundBody.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            <div className="clp-dialog__actions">
              <button ref={secondaryRef} type="button" className="clp-secondary hy-press" onClick={dismiss} disabled={permissionBusy} data-progress-owner="permission-request">
                {copy.later}
              </button>
              <button type="button" className="clp-primary hy-press" onClick={() => void requestBackground()} disabled={permissionBusy} aria-busy={permissionBusy}>
                {permissionBusy ? copy.opening : copy.openSettings}
              </button>
            </div>
          </>
        )}

        {(stage === "foregroundDenied" || stage === "backgroundDenied") && (
          <>
            <span className="clp-dialog__eyebrow">{copy.deniedEyebrow}</span>
            <h2 ref={stageTitleRef} id={titleId} tabIndex={-1}>
              {locationUnsupported ? copy.unsupportedTitle : copy.deniedTitle}
            </h2>
            <div id={descriptionId} className="clp-dialog__copy">
              <p>{locationUnsupported ? copy.unsupportedBody : copy.deniedBody}</p>
              <p>{copy.deniedFollowup}</p>
            </div>
            <div className="clp-dialog__actions">
              <button ref={secondaryRef} type="button" className="clp-secondary hy-press" onClick={dismiss} disabled={permissionBusy} data-progress-owner="permission-request">
                {copy.withoutPermission}
              </button>
              {!locationUnsupported && (
                <button type="button" className="clp-primary hy-press" onClick={retry} disabled={permissionBusy}>
                  {copy.retry}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
