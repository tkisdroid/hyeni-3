import { useEffect, useState } from "react";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { useAdminAiPrompt, useAdminStatus, useSaveAdminAiPrompt } from "@/queries/useAdmin";
import "./AdminAiPrompt.css";

/**
 * 운영자 전용 — 아이 AI 친구 전역 지침.
 *
 * 여기서 저장한 문장은 **모든 가족의 아이 대화**에 함께 들어간다. 서버는 이 지침을
 * 안전 규칙보다 앞에 배치하고 정책 우선순위에서 안전·부모 설정 아래에 두므로,
 * 안전 규칙이나 부모 설정을 무시하게 만들 수는 없다.
 *
 * 메뉴에는 노출하지 않는 숨은 라우트(#/admin/ai-prompt)이며, 운영자 계정이 아니면
 * 안내만 보여준다(서버도 404로 닫는다).
 */
export function AdminAiPrompt() {
  const goBack = useSafeBack();
  const { show } = useToast();
  const adminStatus = useAdminStatus();
  const isAdmin = adminStatus.data?.isAdmin === true;
  const promptQuery = useAdminAiPrompt(isAdmin);
  const savePrompt = useSaveAdminAiPrompt();

  const [draft, setDraft] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // 서버 값이 도착하면 1회만 편집창에 넣는다(입력 중 덮어쓰지 않도록).
  const serverPrompt = promptQuery.data?.prompt ?? null;
  const serverUpdatedAt = promptQuery.data?.updatedAt ?? null;
  useEffect(() => {
    if (serverPrompt === null) return;
    const key = `${serverUpdatedAt ?? ""}:${serverPrompt.length}`;
    if (loadedKey === key) return;
    setDraft(serverPrompt);
    setLoadedKey(key);
  }, [serverPrompt, serverUpdatedAt, loadedKey]);

  const maxLength = promptQuery.data?.maxLength ?? 4000;
  const dirty = serverPrompt !== null && draft !== serverPrompt;

  const handleSave = async () => {
    if (savePrompt.isPending) return;
    try {
      const saved = await savePrompt.mutateAsync(draft);
      setDraft(saved.prompt);
      setLoadedKey(`${saved.updatedAt ?? ""}:${saved.prompt.length}`);
      show(saved.prompt ? "전역 지침을 저장했어요." : "전역 지침을 비웠어요.");
    } catch {
      show("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <div className="aap-root hy-content">
      <div className="aap-header">
        <button type="button" className="aap-back hy-press" aria-label="뒤로" onClick={goBack}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <h1 className="aap-title">AI 친구 전역 지침</h1>
      </div>

      {adminStatus.isLoading ? (
        <p className="aap-state" role="status">권한을 확인하는 중이에요…</p>
      ) : !isAdmin ? (
        <div className="aap-state aap-state--denied" role="alert">
          <ShieldAlert size={18} strokeWidth={2.2} aria-hidden="true" />
          <span>이 페이지는 운영자 계정에서만 열 수 있어요.</span>
        </div>
      ) : (
        <>
          <div className="aap-notice">
            <strong>모든 아이에게 적용됩니다.</strong>
            <span>
              여기에 쓴 지침은 아이 AI 친구가 대화할 때마다 함께 들어가요. 안전 규칙과 부모 설정이
              항상 우선하므로, 그 둘을 무시하게 만들 수는 없어요.
            </span>
          </div>

          {promptQuery.isLoading ? (
            <p className="aap-state" role="status">저장된 지침을 불러오는 중이에요…</p>
          ) : promptQuery.isError ? (
            <div className="aap-state aap-state--error" role="alert">
              <span>지침을 불러오지 못했어요.</span>
              <button type="button" className="aap-retry hy-press" onClick={() => void promptQuery.refetch()}>
                다시 시도
              </button>
            </div>
          ) : (
            <>
              <label className="aap-label" htmlFor="aap-textarea">
                AI 친구에게 줄 지침
              </label>
              <textarea
                id="aap-textarea"
                className="aap-textarea"
                value={draft}
                maxLength={maxLength}
                rows={12}
                placeholder={"예) 답은 세 문장 안으로 짧게 해줘.\n예) 아이가 숙제 얘기를 하면 먼저 칭찬부터 해줘."}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="aap-meta">
                <span>{draft.length} / {maxLength}자</span>
                {promptQuery.data?.updatedAt && (
                  <span>마지막 저장 {promptQuery.data.updatedAt.slice(0, 16).replace("T", " ")}</span>
                )}
              </div>

              <button
                type="button"
                className="aap-save hy-press"
                onClick={() => void handleSave()}
                disabled={savePrompt.isPending || !dirty}
              >
                {savePrompt.isPending ? "저장 중…" : dirty ? "저장하기" : "저장됨"}
              </button>
              <p className="aap-hint">
                비워 두고 저장하면 전역 지침 없이 기본 동작으로 돌아가요.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
