/**
 * 렌더 크래시 안전망 — "조용한 흰 화면" 금지.
 *
 * - RouteErrorScreen: react-router errorElement. 라우트 렌더 중 던져진 에러를 받아
 *   브랜드 복구 화면을 보여준다(대부분의 화면 크래시가 여기로 온다).
 * - RootErrorBoundary: 라우터 밖(프로바이더 등)에서 터진 에러의 최후 방어.
 * 둘 다 같은 ErrorFallback UI 를 쓴다. 복구는 상태를 확실히 비우는 새로고침 기반.
 */
import { Component, useEffect, type ReactNode } from "react";
import { useRouteError } from "react-router";
import { asset } from "@/lib/assets";
import { recordFeedbackDiagnostic } from "@/lib/feedbackDiagnostics";
import { useIntl } from "react-intl";

function homeHashForSession(): string {
  try {
    const raw = window.localStorage.getItem("hyeni-api-session-v1");
    const role = raw ? (JSON.parse(raw)?.user?.role as string | undefined) : undefined;
    if (role === "child") return "#/child/home";
    if (role === "teacher") return "#/teacher/home";
  } catch {
    // 세션을 못 읽으면 부모 홈으로 — 가드가 알아서 온보딩으로 보낸다.
  }
  return "#/parent/home";
}

function isChildSession(): boolean {
  try {
    const raw = window.localStorage.getItem("hyeni-api-session-v1");
    return raw ? JSON.parse(raw)?.user?.role === "child" : false;
  } catch {
    return false;
  }
}

function ErrorFallback() {
  const intl = useIntl();
  const childTone = isChildSession();
  const retry = () => window.location.reload();
  const goHome = () => {
    window.location.hash = homeHashForSession();
    window.location.reload();
  };
  const reportProblem = () => {
    window.location.hash = "#/feedback";
    window.location.reload();
  };
  return (
    <div className="hy-crash" role="alert">
      <img className="hy-crash__img" src={asset("mascot/thinking.webp")} alt="" />
      <div className="hy-crash__title">{intl.formatMessage({ id: childTone ? "core.crash.title.child" : "core.crash.title.formal" })}</div>
      <div className="hy-crash__sub">
        {intl.formatMessage({ id: childTone ? "core.crash.safe.child" : "core.crash.safe.formal" })}
        <br />
        {intl.formatMessage({ id: childTone ? "core.crash.recovery.child" : "core.crash.recovery.formal" })}
      </div>
      <button type="button" className="hy-crash__btn hy-press" onClick={goHome}>
        {intl.formatMessage({ id: "core.action.goHome" })}
      </button>
      <button type="button" className="hy-crash__ghost hy-press" onClick={retry}>
        {intl.formatMessage({ id: "core.action.reloadScreen" })}
      </button>
      <button type="button" className="hy-crash__ghost hy-press" onClick={reportProblem}>
        {intl.formatMessage({ id: childTone ? "core.action.reportProblem.child" : "core.action.reportProblem.formal" })}
      </button>
    </div>
  );
}

/** react-router errorElement 용 — 라우트 렌더 에러를 받아 복구 화면을 그린다. */
export function RouteErrorScreen() {
  const error = useRouteError();
  useEffect(() => {
    // 화면에는 부드럽게, 로그(logcat/CDP)에는 원인 그대로 — 진단 가능성 유지.
    recordFeedbackDiagnostic({ kind: "render", error });
    console.error("[route-error]", error);
  }, [error]);
  return <ErrorFallback />;
}

type BoundaryState = { error: unknown | null };

/** 라우터 밖 크래시의 최후 방어(프로바이더·전역 훅). */
export class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    recordFeedbackDiagnostic({ kind: "render", error });
    console.error("[root-error]", error);
  }

  render() {
    if (this.state.error != null) return <ErrorFallback />;
    return this.props.children;
  }
}
