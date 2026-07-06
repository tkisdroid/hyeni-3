import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { asset } from "@/lib/assets";
import { openExternal } from "@/lib/native/browser";
import "./AppUpdate.css";

const STORE_URL = "https://play.google.com/store/apps/details?id=com.hyeni.calendar";

/** C-14 앱 업데이트 안내. 권장(나중에 가능) 기본. 강제 모드는 state.forced 로 '나중에' 숨김. */
export function AppUpdate() {
  const navigate = useNavigate();
  const forced = false; // 강제 업데이트는 최소버전 체크(스플래시) 결과로 상위에서 forced state 주입 예정

  const update = () => {
    void openExternal(STORE_URL);
  };

  return (
    <div className="au-root">
      <div className="au-card">
        <img className="au-mascot" src={asset("mascot/wave.webp")} alt="" />
        <div className="au-badge">
          <Sparkles size={13} strokeWidth={2.6} />새 버전
        </div>
        <div className="au-title">더 좋아진 혜니캘린더가 나왔어요</div>
        <div className="au-sub">
          안전·위치 기능이 개선됐어요.
          <br />
          최신 버전으로 업데이트해 주세요.
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
