import { useLocation, useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import { asset } from "@/lib/assets";
import { openExternal } from "@/lib/native/browser";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useIntl } from "react-intl";
import "./AppUpdate.css";

const STORE_URL = "https://play.google.com/store/apps/details?id=com.hyeni.calendar";

/**
 * C-14 앱 업데이트 안내. 기본은 권장이며 '나중에'로 닫고 기존 버전을 계속 쓸 수 있다.
 * forced 쿼리는 운영자가 정책에서 blockingUpdate를 켠 예외 상황에만 전달된다.
 */
export function AppUpdate() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { search } = useLocation();
  const { show } = useToast();
  const { role } = useAuth();
  const childTone = role === "child";
  const searchParams = new URLSearchParams(search);
  const forced = searchParams.get("forced") === "1";
  const targetVersion = searchParams.get("target");

  const update = () => {
    openExternal(STORE_URL).catch(() => show(
      intl.formatMessage({
        id: childTone
          ? "core.appUpdate.storeFailure.child"
          : "core.appUpdate.storeFailure.formal",
      }),
      "⚠️",
    ));
  };

  return (
    <div className="au-root">
      <div className="au-card">
        <img className="au-mascot" src={asset("mascot/wave.webp")} alt="" />
        <div className="au-badge">
          <Sparkles size={13} strokeWidth={2.6} />
          {targetVersion
            ? intl.formatMessage(
                { id: "core.appUpdate.badgeVersion" },
                { version: targetVersion },
              )
            : intl.formatMessage({ id: "core.appUpdate.badge" })}
        </div>
        <div className="au-title">
          {intl.formatMessage({
            id: childTone ? "core.appUpdate.title.child" : "core.appUpdate.title.formal",
          })}
        </div>
        <div className="au-sub">
          {intl.formatMessage({
            id: childTone ? "core.appUpdate.improved.child" : "core.appUpdate.improved.formal",
          })}
          <br />
          {intl.formatMessage({
            id: forced
              ? childTone
                ? "core.appUpdate.required.child"
                : "core.appUpdate.required.formal"
              : childTone
                ? "core.appUpdate.optional.child"
                : "core.appUpdate.optional.formal",
          })}
        </div>
        <button type="button" className="au-cta hy-press" onClick={update}>
          {intl.formatMessage({ id: "core.appUpdate.updateNow" })}
        </button>
        {!forced && (
          <button type="button" className="au-later hy-press" onClick={() => navigate(-1)}>
            {intl.formatMessage({ id: "core.appUpdate.later" })}
          </button>
        )}
      </div>
    </div>
  );
}
