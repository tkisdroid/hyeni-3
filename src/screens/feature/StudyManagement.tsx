import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";
import { useActiveChild } from "@/app/activeChild";
import { StudyChildTabs } from "@/components/study/StudyChildTabs";
import { StudyDevicesPanel } from "@/components/study/StudyDevicesPanel";
import { StudyReportPanel } from "@/components/study/StudyReportPanel";
import { STUDY_COPY_KO } from "@/components/study/studyCopy.ko";
import { useMyFamily } from "@/queries/useFamily";
import { useStudyChildren, useStudyDevices, useStudyReport, useStudyStatus } from "@/queries/useStudy";
import {
  buildStudyManagementView,
  resolveSelectedStudyMember,
  selectActiveStudyChildren,
} from "@/transform/studyManagementView";
import "./StudyManagement.css";

export function StudyManagement() {
  const navigate = useNavigate();
  const { activeChild } = useActiveChild();
  const familyQuery = useMyFamily();
  const statusQuery = useStudyStatus();
  const featureState = statusQuery.isError ? "unavailable" : statusQuery.data?.state;
  const childrenQuery = useStudyChildren(featureState);
  const studyChildren = childrenQuery.data?.children ?? [];
  const activeStudyChildren = useMemo(
    () => selectActiveStudyChildren(familyQuery.data?.members ?? []),
    [familyQuery.data?.members],
  );
  const [requestedMemberId, setRequestedMemberId] = useState<string | null>(null);

  useEffect(() => {
    setRequestedMemberId((current) => {
      const retained = resolveSelectedStudyMember(activeStudyChildren, current);
      if (retained) return retained;
      return resolveSelectedStudyMember(activeStudyChildren, activeChild?.id ?? null);
    });
  }, [activeChild?.id, activeStudyChildren]);

  const selectedStudyMember = resolveSelectedStudyMember(activeStudyChildren, requestedMemberId);
  const selectedStudyChild = selectedStudyMember
    ? studyChildren.find((child) => child.memberId === selectedStudyMember)
    : undefined;
  const reportQuery = useStudyReport(
    selectedStudyMember ?? "",
    "7d",
    selectedStudyChild?.linked ? featureState : undefined,
  );
  const devicesQuery = useStudyDevices(selectedStudyMember ?? "", featureState);
  const detailLoading = featureState === "ready" && Boolean(selectedStudyMember) && (
    devicesQuery.isLoading || (selectedStudyChild?.linked === true && reportQuery.isLoading)
  );
  const studyManagementLoading = familyQuery.isLoading
    || statusQuery.isLoading
    || (featureState === "ready" && childrenQuery.isLoading)
    || detailLoading;
  const studyManagementError = familyQuery.isError
    || statusQuery.isError
    || featureState === "unavailable"
    || childrenQuery.isError
    || devicesQuery.isError
    || (selectedStudyChild?.linked === true && reportQuery.isError);
  const canManageLinks = devicesQuery.data?.permissions.canManageLinks
    ?? reportQuery.data?.permissions.canManageLinks
    ?? selectedStudyChild?.canManageLinks
    ?? false;
  const view = buildStudyManagementView({
    featureState,
    activeChildren: activeStudyChildren,
    selectedMemberId: selectedStudyMember,
    studyChild: selectedStudyChild,
    report: reportQuery.data?.report,
    devices: devicesQuery.data?.devices ?? [],
    canManageLinks,
    loading: studyManagementLoading,
    unavailable: studyManagementError,
  });

  const retryStudyManagement = async () => {
    const statusResult = await statusQuery.refetch();
    if (statusResult.data?.state !== "ready") return;
    await Promise.all([
      familyQuery.refetch(),
      childrenQuery.refetch(),
      ...(selectedStudyMember ? [devicesQuery.refetch()] : []),
      ...(selectedStudyMember && selectedStudyChild?.linked ? [reportQuery.refetch()] : []),
    ]);
  };

  return (
    <main className="study-management hy-screen">
      <header className="study-management__header">
        <button
          type="button"
          className="study-management__back hy-press"
          aria-label={STUDY_COPY_KO.screen.back}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1>{STUDY_COPY_KO.screen.title}</h1>
      </header>

      <div className="study-management__content">
        <section className="study-management__intro">
          <span className="study-management__symbol" aria-hidden="true">÷</span>
          <div>
            <h2>{STUDY_COPY_KO.screen.introTitle}</h2>
            <p>{STUDY_COPY_KO.screen.introDescription}</p>
          </div>
        </section>

        {activeStudyChildren.length > 0 && (
          <StudyChildTabs
            children={activeStudyChildren}
            selectedMemberId={selectedStudyMember}
            onSelect={setRequestedMemberId}
          />
        )}

        {view.kind === "loading" ? (
          <section className="study-management__state" aria-live="polite">
            <span className="study-management__spinner" aria-hidden="true" />
            <p>{STUDY_COPY_KO.screen.loading}</p>
          </section>
        ) : view.kind === "service-unavailable" ? (
          <section className="study-management__state" role="alert">
            <h2>{STUDY_COPY_KO.screen.unavailableTitle}</h2>
            <p>{STUDY_COPY_KO.screen.unavailableDescription}</p>
            <button type="button" className="study-management__retry hy-press" onClick={() => void retryStudyManagement()}>
              <RefreshCw size={17} aria-hidden="true" />
              {STUDY_COPY_KO.screen.retry}
            </button>
          </section>
        ) : view.kind === "service-disabled" ? (
          <section className="study-management__state">
            <h2>{STUDY_COPY_KO.screen.disabledTitle}</h2>
            <p>{STUDY_COPY_KO.screen.disabledDescription}</p>
          </section>
        ) : view.kind === "no-active-children" ? (
          <section className="study-management__state">
            <h2>{STUDY_COPY_KO.screen.emptyTitle}</h2>
            <p>{STUDY_COPY_KO.screen.emptyDescription}</p>
          </section>
        ) : view.kind === "select-child" ? (
          <section className="study-management__state">
            <h2>{STUDY_COPY_KO.tabs.chooseTitle}</h2>
            <p>{STUDY_COPY_KO.tabs.chooseDescription}</p>
          </section>
        ) : view.kind === "unlinked" ? (
          <section className="study-management__state">
            <span className="study-management__child-avatar" aria-hidden="true">
              {view.child.displayName.trim().slice(0, 1) || "아"}
            </span>
            <h2>{view.child.displayName}</h2>
            <p>{STUDY_COPY_KO.screen.unlinkedDescription}</p>
          </section>
        ) : (
          <>
            <StudyReportPanel child={view.child} report={view.report} />
            <StudyDevicesPanel
              memberId={view.child.memberId}
              devices={view.devices}
              canManageLinks={view.canManageLinks}
            />
          </>
        )}
      </div>
    </main>
  );
}
