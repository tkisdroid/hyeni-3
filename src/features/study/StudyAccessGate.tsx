import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { useMyFamily, useConfirmServiceCountry } from "@/queries/useFamily";
import { useStudyStatus } from "@/queries/useStudy";
import { StudyCountryConfirmation } from "./StudyCountryConfirmation";
import { resolveStudyAccessView } from "./studyAccessModel";
import "./study-access.css";

export function StudyAccessGate({
  children,
  onBack,
}: Readonly<{ children: ReactNode; onBack?: () => void }>) {
  const intl = useIntl();
  const status = useStudyStatus();
  const family = useMyFamily();
  const confirm = useConfirmServiceCountry();
  const view = resolveStudyAccessView(status.data);

  if (status.isPending || view.kind === "loading") {
    return <div className="study-access-status" role="status">{intl.formatMessage({ id: "study.access.loading" })}</div>;
  }
  if (view.kind === "hidden") return null;
  if (view.kind === "enabled") return <>{children}</>;
  if (view.kind === "confirm") {
    const rowVersion = family.data?.serviceCountryRowVersion;
    if (!family.data?.isPrimaryParent || rowVersion === null || rowVersion === undefined) return null;
    return (
      <StudyCountryConfirmation
        suggestedCountry={view.inferredCountry}
        initialCountry={family.data.serviceCountry}
        busy={confirm.isPending}
        onConfirm={async (country) => {
          await confirm.mutateAsync({ country, rowVersion, requestId: crypto.randomUUID() });
        }}
      />
    );
  }
  return (
    <section className="study-access-status" role="alert">
      <h2>{intl.formatMessage({ id: "study.unavailable.title" })}</h2>
      <div className="study-access-actions">
        <button type="button" className="study-access-action" onClick={() => void status.refetch()}>
          {intl.formatMessage({ id: "study.unavailable.retry" })}
        </button>
        {onBack && (
          <button type="button" className="study-access-action study-access-secondary" onClick={onBack}>
            {intl.formatMessage({ id: "study.unavailable.back" })}
          </button>
        )}
      </div>
    </section>
  );
}
