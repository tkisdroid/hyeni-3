import { useEffect, useState } from "react";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { isApiError } from "@/lib/api/errors";
import {
  useAdminAiPrompt,
  useAdminCommerceControls,
  useAdminStatus,
  useSaveAdminAiPrompt,
  useSaveAdminCommerceControls,
} from "@/queries/useAdmin";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
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
  const commerceQuery = useAdminCommerceControls(isAdmin);
  const savePrompt = useSaveAdminAiPrompt();
  const saveCommerceControls = useSaveAdminCommerceControls();

  const [draft, setDraft] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
  const [aiCreditEnabled, setAiCreditEnabled] = useState(false);
  const [commerceLoadedKey, setCommerceLoadedKey] = useState<string | null>(null);
  const [commerceFeedback, setCommerceFeedback] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

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

  const serverCommerceControls = commerceQuery.data ?? null;
  useEffect(() => {
    if (serverCommerceControls === null) return;
    const key = [
      serverCommerceControls.configured,
      serverCommerceControls.webSubscriptionNewCheckoutsEnabled,
      serverCommerceControls.webAiCreditNewCheckoutsEnabled,
    ].join(":");
    if (commerceLoadedKey === key) return;
    setSubscriptionEnabled(serverCommerceControls.webSubscriptionNewCheckoutsEnabled);
    setAiCreditEnabled(serverCommerceControls.webAiCreditNewCheckoutsEnabled);
    setCommerceLoadedKey(key);
    setCommerceFeedback(null);
  }, [serverCommerceControls, commerceLoadedKey]);

  const maxLength = promptQuery.data?.maxLength ?? 4000;
  const dirty = serverPrompt !== null && draft !== serverPrompt;
  const commerceDirty = serverCommerceControls !== null && (
    !serverCommerceControls.configured ||
    subscriptionEnabled !== serverCommerceControls.webSubscriptionNewCheckoutsEnabled ||
    aiCreditEnabled !== serverCommerceControls.webAiCreditNewCheckoutsEnabled
  );
  const commerceStorageUnavailable =
    isApiError(commerceQuery.error) && commerceQuery.error.status === 503;
  usePwaUpdateCriticalSection(
    dirty || commerceDirty || savePrompt.isPending || saveCommerceControls.isPending,
  );

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

  const handleCommerceSave = async () => {
    if (saveCommerceControls.isPending || !commerceDirty) return;
    setCommerceFeedback(null);
    try {
      const saved = await saveCommerceControls.mutateAsync({
        webSubscriptionNewCheckoutsEnabled: subscriptionEnabled,
        webAiCreditNewCheckoutsEnabled: aiCreditEnabled,
      });
      setSubscriptionEnabled(saved.webSubscriptionNewCheckoutsEnabled);
      setAiCreditEnabled(saved.webAiCreditNewCheckoutsEnabled);
      setCommerceLoadedKey([
        true,
        saved.webSubscriptionNewCheckoutsEnabled,
        saved.webAiCreditNewCheckoutsEnabled,
      ].join(":"));
      setCommerceFeedback({ tone: "success", message: "두 신규 결제 설정을 함께 저장했습니다." });
      show("신규 결제 운영 제어를 저장했어요.");
    } catch {
      setCommerceFeedback({
        tone: "error",
        message: "저장 결과를 확인하지 못했습니다. 다시 저장하거나 새로 불러와 현재 상태를 확인해 주세요.",
      });
      show("운영 제어를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <div className="aap-root hy-content">
      <div className="aap-header">
        <button type="button" className="aap-back hy-press" aria-label="뒤로" onClick={goBack}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <h1 className="aap-title">운영자 설정</h1>
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
          <section className="aap-section" aria-labelledby="aap-commerce-title">
            <div className="aap-section-head">
              <div>
                <h2 id="aap-commerce-title">신규 결제 운영 제어</h2>
                <p>웹에서 시작하는 신규 결제만 제어합니다.</p>
              </div>
              {commerceQuery.data && (
                <span
                  className={
                    commerceQuery.data.configured && !commerceDirty
                      ? "aap-badge"
                      : "aap-badge aap-badge--off"
                  }
                >
                  {!commerceQuery.data.configured
                    ? "안전 중지"
                    : commerceDirty
                      ? "저장 전 변경"
                      : "설정 저장됨"}
                </span>
              )}
            </div>

            <div className="aap-commerce-note">
              <strong>운영 기본은 중지입니다.</strong>
              <span>
                migration·readback·외부 결제 E2E를 모두 확인한 뒤에만 허용해 주세요.
                기존 주문의 완료·대사·해지·환불은 계속 처리됩니다.
              </span>
            </div>

            {commerceQuery.isLoading ? (
              <p className="aap-state" role="status">운영 제어를 불러오는 중이에요…</p>
            ) : commerceQuery.isError ? (
              <div className="aap-state aap-state--error aap-state--stack" role="alert">
                <span>
                  {commerceStorageUnavailable
                    ? "운영 제어 저장소 오류(503)로 현재 값을 확인하지 못했습니다. 서버는 신규 결제를 안전하게 중지합니다."
                    : "운영 제어를 불러오지 못했습니다. 확인되지 않은 상태에서는 신규 결제를 허용으로 표시하지 않습니다."}
                </span>
                <button
                  type="button"
                  className="aap-retry hy-press"
                  onClick={() => void commerceQuery.refetch()}
                >
                  다시 시도
                </button>
              </div>
            ) : serverCommerceControls ? (
              <>
                {!serverCommerceControls.configured && (
                  <p className="aap-commerce-unconfigured" role="alert">
                    설정이 아직 만들어지지 않아 신규 결제가 안전하게 중지되어 있습니다.
                    두 항목을 확인한 뒤 함께 저장해 주세요.
                  </p>
                )}

                <div className="aap-commerce-fields">
                  <fieldset className="aap-commerce-field" disabled={saveCommerceControls.isPending}>
                    <legend>웹 구독 신규 결제</legend>
                    <div className="aap-commerce-options">
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-subscription-checkouts"
                          checked={!subscriptionEnabled}
                          onChange={() => {
                            setSubscriptionEnabled(false);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span><strong>중지</strong><small>신규 구독 결제를 열지 않습니다.</small></span>
                      </label>
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-subscription-checkouts"
                          checked={subscriptionEnabled}
                          onChange={() => {
                            setSubscriptionEnabled(true);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span><strong>허용</strong><small>검증을 마친 뒤에만 선택해 주세요.</small></span>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="aap-commerce-field" disabled={saveCommerceControls.isPending}>
                    <legend>웹 AI 크레딧 신규 결제</legend>
                    <div className="aap-commerce-options">
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-ai-credit-checkouts"
                          checked={!aiCreditEnabled}
                          onChange={() => {
                            setAiCreditEnabled(false);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span><strong>중지</strong><small>신규 크레딧 결제를 열지 않습니다.</small></span>
                      </label>
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-ai-credit-checkouts"
                          checked={aiCreditEnabled}
                          onChange={() => {
                            setAiCreditEnabled(true);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span><strong>허용</strong><small>검증을 마친 뒤에만 선택해 주세요.</small></span>
                      </label>
                    </div>
                  </fieldset>
                </div>

                <button
                  type="button"
                  className="aap-commerce-save hy-press"
                  onClick={() => void handleCommerceSave()}
                  disabled={saveCommerceControls.isPending || !commerceDirty}
                  aria-busy={saveCommerceControls.isPending}
                >
                  {saveCommerceControls.isPending
                    ? "저장 중…"
                    : commerceDirty
                      ? "두 설정을 한 번에 저장"
                      : "운영 제어 저장됨"}
                </button>

                {commerceFeedback?.tone === "success" && (
                  <p className="aap-feedback aap-feedback--success" role="status" aria-live="polite">
                    {commerceFeedback.message}
                  </p>
                )}
                {commerceFeedback?.tone === "error" && (
                  <p className="aap-feedback aap-feedback--error" role="alert" aria-live="polite">
                    {commerceFeedback.message}
                  </p>
                )}
              </>
            ) : null}
          </section>

          <section className="aap-section" aria-labelledby="aap-prompt-title">
            <div className="aap-section-head">
              <div>
                <h2 id="aap-prompt-title">AI 친구 전역 지침</h2>
                <p>모든 가족의 아이 AI 대화에 적용합니다.</p>
              </div>
            </div>

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
                  aria-busy={savePrompt.isPending}
                >
                  {savePrompt.isPending ? "저장 중…" : dirty ? "저장하기" : "저장됨"}
                </button>
                <p className="aap-hint">
                  비워 두고 저장하면 전역 지침 없이 기본 동작으로 돌아가요.
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
