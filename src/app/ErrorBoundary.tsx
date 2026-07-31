/**
 * 렌더 크래시 안전망 — "조용한 흰 화면" 금지.
 *
 * - RouteErrorScreen: react-router errorElement. 라우트 렌더 중 던져진 에러를 받아
 *   브랜드 복구 화면을 보여준다(대부분의 화면 크래시가 여기로 온다).
 * - RootErrorBoundary: 라우터 밖(프로바이더 등)에서 터진 에러의 최후 방어.
 * 둘 다 같은 ErrorFallback UI 를 쓴다. 복구는 상태를 확실히 비우는 새로고침 기반.
 */
import { Component, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";
import { asset } from "@/lib/assets";

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

function ErrorFallback({ error }: { error: unknown }) {
  const childTone = isChildSession();
  const retry = () => window.location.reload();
  const goHome = () => {
    window.location.hash = homeHashForSession();
    window.location.reload();
  };
  const detail = import.meta.env.DEV
    ? error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
    : "";
  return (
    <div className="hy-crash" role="alert">
      <img className="hy-crash__img" src={asset("mascot/thinking.webp")} alt="" />
      <div className="hy-crash__title">{childTone ? "앗, 화면이 잠깐 멈췄어" : "앗, 화면이 잠깐 멈췄어요"}</div>
      <div className="hy-crash__sub">
        {childTone ? "걱정하지 마. 저장한 내용은 안전해." : "걱정하지 마세요. 저장한 내용은 안전해요."}
        <br />
        {childTone ? "아래 버튼으로 다시 열 수 있어." : "아래 버튼으로 다시 열 수 있어요."}
      </div>
      <button type="button" className="hy-crash__btn hy-press" onClick={goHome}>
        홈으로 가기
      </button>
      <button type="button" className="hy-crash__ghost hy-press" onClick={retry}>
        이 화면 다시 열기
      </button>
      {detail && <div className="hy-crash__detail">{detail.slice(0, 120)}</div>}
    </div>
  );
}

/** react-router errorElement 용 — 라우트 렌더 에러를 받아 복구 화면을 그린다. */
export function RouteErrorScreen() {
  const error = useRouteError();
  // 화면에는 부드럽게, 로그(logcat/CDP)에는 원인 그대로 — 진단 가능성 유지.
  console.error("[route-error]", error);
  return <ErrorFallback error={error} />;
}

type BoundaryState = { error: unknown | null };

/** 라우터 밖 크래시의 최후 방어(프로바이더·전역 훅). */
export class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("[root-error]", error);
  }

  render() {
    if (this.state.error != null) return <ErrorFallback error={this.state.error} />;
    return this.props.children;
  }
}
