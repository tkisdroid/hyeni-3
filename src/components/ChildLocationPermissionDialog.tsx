import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import type { MessageId } from "@/i18n/generated/messageIds";
import {
  openUsageAccessSettings,
  readUsageAccessState,
  requestBackgroundLocationPermission,
  requestForegroundLocationPermission,
} from "@/lib/native/permissions";
import {
  advanceLocationPermissionStage,
  type LocationPermissionStage,
} from "@/transform/locationPermissionFlow";
import { writeUsageAccessPromptedAt } from "@/transform/usageAccessPrompt";
import "./ChildLocationPermissionDialog.css";

type CopyMode = "formal" | "child";

/**
 * 문구는 locale catalog 가 정본이고, 여기에는 **id 만** 둔다.
 * 톤(존댓말/반말)은 `copyMode` 가 고르는 id 접미사로만 갈린다 — 다른 언어도 같은 방식으로
 * parent/child 문맥을 분리한다. 원문을 다시 여기에 적으면 그 언어에서만 한국어가 새어 나온다.
 */
const COPY_KEYS = [
  "disclosure.eyebrow",
  "disclosure.title",
  "disclosure.collection",
  "disclosure.purpose",
  "disclosure.control",
  "background.eyebrow",
  "background.title",
  "background.description",
  "background.optional",
  "usage.eyebrow",
  "usage.title",
  "usage.reason",
  "usage.optional",
  "usage.open",
  "usage.done",
  "denied.eyebrow",
  "denied.title",
  "denied.consequence",
  "denied.followup",
  "unsupported.title",
  "unsupported.body",
  "action.later",
  "action.continue",
  "action.openSettings",
  "action.withoutPermission",
  "action.retry",
  "action.checking",
  "action.opening",
] as const;

type CopyKey = (typeof COPY_KEYS)[number];

function messageId(key: CopyKey, copyMode: CopyMode): MessageId {
  return `shared.locationPermission.${key}.${copyMode === "child" ? "child" : "formal"}` as MessageId;
}


interface ChildLocationPermissionDialogProps {
  open: boolean;
  copyMode: CopyMode;
  onDismiss: () => void;
  onPermissionGranted: () => void | Promise<void>;
  /**
   * 열릴 때 시작할 단계. 기본은 위치 안내부터이고, 위치는 이미 켰지만 사용 정보 접근만
   * 꺼져 있는 기기에서는 그 단계만 따로 연다(2026-08-18).
   */
  initialStage?: "disclosure" | "usageAccess";
  /** 사용 정보 접근 단계를 보여 준 시각을 남길 저장 키(다른 화면의 중복 물음 방지). */
  usagePromptStorageKey?: string;
}

export function ChildLocationPermissionDialog({
  open,
  copyMode,
  onDismiss,
  onPermissionGranted,
  initialStage = "disclosure",
  usagePromptStorageKey,
}: ChildLocationPermissionDialogProps) {
  const intl = useIntl();
  const copy = useMemo(() => {
    const resolved = {} as Record<CopyKey, string>;
    for (const key of COPY_KEYS) resolved[key] = intl.formatMessage({ id: messageId(key, copyMode) });
    return resolved;
  }, [copyMode, intl]);
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
      setStage(initialStage === "usageAccess"
        ? "usageAccess"
        : advanceLocationPermissionStage("closed", { type: "open" }));
    } else if (!open && wasOpen) {
      setStage("closed");
    }
  }, [initialStage, open]);

  useEffect(() => {
    const previousStage = previousStageRef.current;
    previousStageRef.current = stage;
    if (previousStage === "closed" || stage === "closed") return;
    stageTitleRef.current?.focus({ preventScroll: true });
  }, [stage]);

  useEffect(() => {
    if (stage !== "usageAccess" || !usagePromptStorageKey || typeof window === "undefined") return;
    writeUsageAccessPromptedAt(window.localStorage, usagePromptStorageKey, Date.now());
  }, [stage, usagePromptStorageKey]);

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
      // 위치를 다 받은 뒤 "오늘 많이 쓴 앱"의 전제인 사용 정보 접근까지 이어서 켠다.
      const usage = result.granted ? await readUsageAccessState() : null;
      const nextStage = advanceLocationPermissionStage(stage, {
        type: "backgroundResult",
        granted: result.granted,
        supported: result.supported,
        usageAccessGranted: usage ? usage.supported && usage.granted : undefined,
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

  const openUsageAccess = async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    try {
      await openUsageAccessSettings();
    } finally {
      setPermissionBusy(false);
    }
  };

  /** 설정에서 돌아온 뒤 실제 상태를 다시 읽는다 — 켰다고 말만 듣고 끝내지 않는다. */
  const confirmUsageAccess = async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    try {
      const usage = await readUsageAccessState();
      const granted = usage.supported && usage.granted;
      setStage(advanceLocationPermissionStage(stage, { type: "usageAccessResult", granted }));
      if (granted) await onPermissionGranted();
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
            <span className="clp-dialog__eyebrow">{copy["disclosure.eyebrow"]}</span>
            <h2 ref={stageTitleRef} id={titleId} tabIndex={-1}>{copy["disclosure.title"]}</h2>
            <div id={descriptionId} className="clp-dialog__copy">
              <p>{copy["disclosure.collection"]}</p>
              <p>{copy["disclosure.purpose"]}</p>
              <p>{copy["disclosure.control"]}</p>
            </div>
            <div className="clp-dialog__actions">
              <button ref={secondaryRef} type="button" className="clp-secondary hy-press" onClick={dismiss} disabled={permissionBusy} data-progress-owner="permission-request">
                {copy["action.later"]}
              </button>
              <button type="button" className="clp-primary hy-press" onClick={() => void requestForeground()} disabled={permissionBusy} aria-busy={permissionBusy}>
                {permissionBusy ? copy["action.checking"] : copy["action.continue"]}
              </button>
            </div>
          </>
        )}

        {stage === "backgroundEducation" && (
          <>
            <span className="clp-dialog__eyebrow">{copy["background.eyebrow"]}</span>
            <h2 ref={stageTitleRef} id={titleId} tabIndex={-1}>{copy["background.title"]}</h2>
            <div id={descriptionId} className="clp-dialog__copy">
              <p>{copy["background.description"]}</p>
              <p>{copy["background.optional"]}</p>
            </div>
            <div className="clp-dialog__actions">
              <button ref={secondaryRef} type="button" className="clp-secondary hy-press" onClick={dismiss} disabled={permissionBusy} data-progress-owner="permission-request">
                {copy["action.later"]}
              </button>
              <button type="button" className="clp-primary hy-press" onClick={() => void requestBackground()} disabled={permissionBusy} aria-busy={permissionBusy}>
                {permissionBusy ? copy["action.opening"] : copy["action.openSettings"]}
              </button>
            </div>
          </>
        )}

        {stage === "usageAccess" && (
          <>
            <span className="clp-dialog__eyebrow">{copy["usage.eyebrow"]}</span>
            <h2 ref={stageTitleRef} id={titleId} tabIndex={-1}>{copy["usage.title"]}</h2>
            <div id={descriptionId} className="clp-dialog__copy">
              <p>{copy["usage.reason"]}</p>
              <p>{copy["usage.optional"]}</p>
            </div>
            <div className="clp-dialog__actions">
              <button ref={secondaryRef} type="button" className="clp-secondary hy-press" onClick={dismiss} disabled={permissionBusy} data-progress-owner="permission-request">
                {copy["action.later"]}
              </button>
              <button type="button" className="clp-secondary hy-press" onClick={() => void openUsageAccess()} disabled={permissionBusy} aria-busy={permissionBusy}>
                {permissionBusy ? copy["action.opening"] : copy["usage.open"]}
              </button>
              <button type="button" className="clp-primary hy-press" onClick={() => void confirmUsageAccess()} disabled={permissionBusy} aria-busy={permissionBusy}>
                {permissionBusy ? copy["action.checking"] : copy["usage.done"]}
              </button>
            </div>
          </>
        )}

        {(stage === "foregroundDenied" || stage === "backgroundDenied") && (
          <>
            <span className="clp-dialog__eyebrow">{copy["denied.eyebrow"]}</span>
            <h2 ref={stageTitleRef} id={titleId} tabIndex={-1}>
              {locationUnsupported ? copy["unsupported.title"] : copy["denied.title"]}
            </h2>
            <div id={descriptionId} className="clp-dialog__copy">
              <p>{locationUnsupported ? copy["unsupported.body"] : copy["denied.consequence"]}</p>
              <p>{copy["denied.followup"]}</p>
            </div>
            <div className="clp-dialog__actions">
              <button ref={secondaryRef} type="button" className="clp-secondary hy-press" onClick={dismiss} disabled={permissionBusy} data-progress-owner="permission-request">
                {copy["action.withoutPermission"]}
              </button>
              {!locationUnsupported && (
                <button type="button" className="clp-primary hy-press" onClick={retry} disabled={permissionBusy} aria-busy={permissionBusy}>
                  {copy["action.retry"]}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
