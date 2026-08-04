import { useLocation, useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import { asset } from "@/lib/assets";
import { openExternal } from "@/lib/native/browser";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import "./AppUpdate.css";

const STORE_URL = "https://play.google.com/store/apps/details?id=com.hyeni.calendar";

/**
 * C-14 앱 업데이트 안내. 기본은 권장이며 '나중에'로 닫고 기존 버전을 계속 쓸 수 있다.
 * forced 쿼리는 운영자가 정책에서 blockingUpdate를 켠 예외 상황에만 전달된다.
 */
export function AppUpdate() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { show } = useToast();
  const { role } = useAuth();
  const childTone = role === "child";
  const forced = new URLSearchParams(search).get("forced") === "1";

  const update = () => {
    openExternal(STORE_URL).catch(() => show(
      childTone ? "스토어를 열 수 없어. 브라우저에서 열어 줘" : "스토어를 열 수 없어요. 브라우저에서 열어 주세요",
      "⚠️",
    ));
  };

  return (
    <div className="au-root">
      <div className="au-card">
        <img className="au-mascot" src={asset("mascot/wave.webp")} alt="" />
        <div className="au-badge">
          <Sparkles size={13} strokeWidth={2.6} />새 버전
        </div>
        <div className="au-title">
          {childTone ? "더 좋아진 혜니캘린더가 나왔어" : "더 좋아진 혜니캘린더가 나왔어요"}
        </div>
        <div className="au-sub">
          {childTone ? "안전·위치 기능이 더 좋아졌어." : "안전·위치 기능이 개선됐어요."}
          <br />
          {forced
            ? (childTone
              ? "이번 버전은 꼭 업데이트해야 계속 쓸 수 있어."
              : "이번 버전은 업데이트해야 계속 사용할 수 있어요.")
            : (childTone
              ? "지금 하지 않아도 계속 쓸 수 있어."
              : "지금 하지 않아도 계속 사용할 수 있어요.")}
        </div>
        <button type="button" className="au-cta hy-press" onClick={update}>
          지금 업데이트
        </button>
        {!forced && (
          <button type="button" className="au-later hy-press" onClick={() => navigate(-1)}>
            나중에
          </button>
        )}
      </div>
    </div>
  );
}
