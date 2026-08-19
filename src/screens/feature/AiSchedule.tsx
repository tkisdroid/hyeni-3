import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Camera, ChevronLeft, Check, Sparkles, Mic, Keyboard, Image as ImageIcon, type LucideIcon } from "lucide-react";
import { asset } from "@/lib/assets";
import { resolveEventVisualAsset } from "@/transform/placeVisual";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useParseSchedule } from "@/queries/useAi";
import { useEvents, useSaveEventsWithChildrenBatch } from "@/queries/useSchedule";
import { useActiveChild } from "@/app/activeChild";
import {
  buildAiScheduleDrafts,
  buildAiScheduleSaveInputs,
  type AiScheduleDraft,
} from "@/transform/aiScheduleDraft";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import { ApiError } from "@/lib/api/errors";
import { cancelSpeechCapture, captureSpeech, isSpeechCaptureSupported } from "@/lib/native/speech";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import { useEntitlement } from "@/queries/useEntitlement";
import { canUse, FEATURES } from "@/transform/tierPolicy";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { MAX_SUPPLY_ITEMS_PER_KIND } from "@/transform/eventSupplies";
import "./AiSchedule.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

type TabKey = "voice" | "text" | "image";

// 탭 아이콘 — 유니코드 이모지 대신 lucide 라인 아이콘(비싼 심플함 유지).
const AI_TABS: ReadonlyArray<{ key: TabKey; Icon: LucideIcon; messageId: string }> = [
  { key: "voice", Icon: Mic, messageId: "parent.aiSchedule.tabVoice" },
  { key: "text", Icon: Keyboard, messageId: "parent.aiSchedule.tabText" },
  { key: "image", Icon: ImageIcon, messageId: "parent.aiSchedule.tabImage" },
];

/** 음성 파형 막대 — 20개, 물결처럼 어긋난 delay. */
const WAVE_BARS = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  delay: `${(-((i * 7) % 11) * 0.09).toFixed(2)}s`,
}));

/** 카테고리(school/sports/...) → 결과 카드 라벨(hyeni-1 CATS 기준). */
const CAT_MESSAGE_ID: Record<string, string> = {
  school: "parent.aiSchedule.categorySchool",
  sports: "parent.aiSchedule.categorySports",
  hobby: "parent.aiSchedule.categoryHobby",
  family: "parent.aiSchedule.categoryFamily",
  friend: "parent.aiSchedule.categoryFriend",
  other: "parent.aiSchedule.categoryOther",
};

const SPEECH_LOCALE: Record<SupportedLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  vi: "vi-VN",
  th: "th-TH",
  id: "id-ID",
  ms: "ms-MY",
  fil: "fil-PH",
};

/** 오늘 기준 currentDate(month 는 0-indexed — voice-parse 상대 날짜 해석용). */
function currentDateParts(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

export function AiSchedule() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const { status, familyId } = useAuth();
  const parseM = useParseSchedule();
  const createM = useSaveEventsWithChildrenBatch();
  const { activeChild } = useActiveChild();
  const [searchParams] = useSearchParams();
  const academyMode = searchParams.get("mode") === "academy";
  const entitlement = useEntitlement();
  const academyAllowed = entitlement.ready && canUse(entitlement.tier, FEATURES.ACADEMY_SCHEDULE);
  const existingEvents = useEvents();
  const aiScheduleQueryState = resolveQueryTruthState([
    { isLoading: existingEvents.isLoading, isError: existingEvents.isError },
    {
      isLoading: academyMode && entitlement.isLoading,
      isError: academyMode && entitlement.isError,
    },
  ]);
  const aiScheduleDataMissing = aiScheduleQueryState === "ready" && existingEvents.data === undefined;
  const aiScheduleDataReady = aiScheduleQueryState === "ready" && !aiScheduleDataMissing;
  const aiScheduleDataEmpty = aiScheduleDataReady && existingEvents.data?.length === 0;
  const aiScheduleRefetching = existingEvents.isFetching;
  const retryAiSchedule = async (): Promise<void> => {
    await Promise.all([
      existingEvents.refetch(),
      ...(academyMode ? [entitlement.refetch()] : []),
    ]);
  };

  // 진입 탭 — 부모 홈 "AI로 일정 추가"의 음성/텍스트/알림장 버튼이 ?tab= 으로 지정한다.
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<TabKey>(
    requestedTab === "text" || requestedTab === "image" || requestedTab === "voice" ? requestedTab : "voice",
  );
  // 화면이 이미 떠 있는 상태에서 ?tab= 만 바뀌는 재진입(같은 문서 해시 변경)도 반영한다.
  useEffect(() => {
    if (requestedTab === "text" || requestedTab === "image" || requestedTab === "voice") {
      setTab(requestedTab);
    }
  }, [requestedTab]);
  const [text, setText] = useState("");
  // 알림장 사진 미리보기(data URI). null = 사진 미선택.
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // 검증된 파싱 결과(미리보기). UUID도 이 시점에 확정해 저장 재시도에서 유지한다.
  const [drafts, setDrafts] = useState<AiScheduleDraft[] | null>(null);
  // 음성 인식 진행 중 여부.
  const [listening, setListening] = useState(false);
  const [academyUpsellOpen, setAcademyUpsellOpen] = useState(false);
  const [scheduleLimitUpsellOpen, setScheduleLimitUpsellOpen] = useState(false);
  // 숨긴 파일 입력 — 업로드 버튼 onClick 에서 트리거(직접 노출하지 않음).
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (academyMode && entitlement.ready && !academyAllowed) {
      setAcademyUpsellOpen(true);
    }
  }, [academyAllowed, academyMode, entitlement.ready]);

  // ── 마이크 오발동 방어(2026-07-14 TK 제보 "진입 시 마이크 자동실행") ──
  // 홈 버튼 탭이 화면 전환 직후 같은 좌표의 큰 마이크 버튼에 고스트 클릭으로 떨어지면
  // 음성 인식이 저절로 시작된다. 진입 후 짧은 무장 지연을 두고, 탭 전환·화면 이탈 시
  // 진행 중 인식은 취소한다(취소된 인식의 결과·토스트는 세대 카운터로 무시).
  const micArmedRef = useRef(false);
  const voiceGenRef = useRef(0);
  useEffect(() => {
    const id = window.setTimeout(() => {
      micArmedRef.current = true;
    }, 700);
    return () => {
      window.clearTimeout(id);
      voiceGenRef.current += 1;
      cancelSpeechCapture();
    };
  }, []);

  const switchTab = (key: TabKey) => {
    if (key === tab) return;
    if (listening) {
      voiceGenRef.current += 1;
      cancelSpeechCapture();
      setListening(false);
    }
    setTab(key);
  };

  const cd = currentDateParts();
  const events = drafts ?? [];
  const hasResult = events.length > 0;
  const count = events.length;
  const screenTitle = intl.formatMessage({
    id: academyMode
      ? "parent.aiSchedule.academyScreenTitle"
      : "parent.aiSchedule.screenTitle",
  });
  // 정리하기 가능 여부 — 알림장 탭은 사진 선택 시, 텍스트·음성 탭은 인식/입력된 내용이 있을 때.
  const canParse = tab === "image" ? imagePreview !== null : text.trim().length > 0;

  // 텍스트가 바뀌면 이전 미리보기는 무효 → 다시 정리하도록 초기화.
  const onTextChange = (value: string) => {
    setText(value);
    if (drafts) setDrafts(null);
  };

  // ── 알림장 사진 선택(실제 파일 입력) — 선택·미리보기는 항상 동작 ──
  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 골라도 onChange 가 발생하도록 값 초기화.
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) {
        show(intl.formatMessage({ id: "parent.aiSchedule.photoLoadError" }), "⚠️");
        return;
      }
      setImagePreview(dataUrl);
      setDrafts(null); // 새 사진 → 이전 인식 결과 무효화.
    };
    reader.onerror = () => show(intl.formatMessage({ id: "parent.aiSchedule.photoLoadError" }), "⚠️");
    reader.readAsDataURL(file);
  };

  // ── AI 정리(파싱) 코어 — 텍스트/알림장 사진 공통. 사용자 버튼 onClick 에서만 호출 ──
  const runParse = async (payloadText: string, image?: string) => {
    if (!aiScheduleDataReady) {
      show(intl.formatMessage({ id: "parent.aiSchedule.dataNotReady" }), "⚠️");
      return;
    }
    if (status !== "authenticated") {
      show(intl.formatMessage({ id: "parent.aiSchedule.loginRequired" }), "🔒");
      return;
    }
    try {
      const result = await parseM.mutateAsync({
        text: payloadText,
        ...(image ? { image } : {}),
        mode: "paste",
        feature: academyMode ? "academy_schedule" : undefined,
        currentDate: cd,
      });
      if (result.events.length === 0) {
        setDrafts(null);
        show(
          intl.formatMessage({
            id: image
              ? "parent.aiSchedule.noImageEvents"
              : "parent.aiSchedule.noTextEvents",
          }),
          "🤔",
        );
        return;
      }
      const prepared = buildAiScheduleDrafts(result.events, cd, () => crypto.randomUUID(), locale, intl);
      if (prepared.error) {
        setDrafts(null);
        const errorMessage = intl.formatMessage(
          {
            id: prepared.error.code === "invalid_title"
              ? "parent.aiSchedule.invalidTitle"
              : prepared.error.code === "invalid_date"
                ? "parent.aiSchedule.invalidDate"
                : "parent.aiSchedule.invalidTime",
          },
          { title: prepared.error.title },
        );
        show(errorMessage, "⚠️");
        return;
      }
      setDrafts(prepared.drafts);
    } catch (e) {
      setDrafts(null);
      if (!academyMode && e instanceof ApiError && e.status === 429 && e.code === "daily_limit_reached") {
        await entitlement.refetch().catch(() => undefined);
        setScheduleLimitUpsellOpen(true);
        return;
      }
      if (academyMode && e instanceof ApiError && e.code === "premium_required") {
        await entitlement.refetch().catch(() => undefined);
        setAcademyUpsellOpen(true);
        show(intl.formatMessage({ id: "parent.aiSchedule.premiumRecheck" }), "⚠️");
        return;
      }
      show(localizeApiError(e, intl, "formal"), "⚠️");
    }
  };

  // ── 음성 인식(STT) → 인식 텍스트를 그대로 AI 정리로 투입 ──
  // 네이티브 SpeechRecognition 플러그인 우선, 웹은 Web Speech API 폴백(@/lib/native/speech).
  const startVoice = async () => {
    if (!micArmedRef.current || listening || parseM.isPending) return;
    if (!aiScheduleDataReady) {
      show(intl.formatMessage({ id: "parent.aiSchedule.dataNotReady" }), "⚠️");
      return;
    }
    if (status !== "authenticated") {
      show(intl.formatMessage({ id: "parent.aiSchedule.loginRequired" }), "🔒");
      return;
    }
    if (!isSpeechCaptureSupported()) {
      show(intl.formatMessage({ id: "parent.aiSchedule.speechUnsupported" }), "🎤");
      setTab("text");
      return;
    }
    const gen = ++voiceGenRef.current;
    setListening(true);
    setDrafts(null);
    try {
      const transcript = await captureSpeech(SPEECH_LOCALE[locale]);
      if (gen !== voiceGenRef.current) return; // 탭 전환·이탈로 취소된 인식 — 결과·토스트 무시
      if (!transcript) {
        show(intl.formatMessage({ id: "parent.aiSchedule.speechEmpty" }), "🎤");
        return;
      }
      setText(transcript);
      // 인식 성공 → 곧바로 AI 정리(결과 카드 표시). 실제 저장은 사용자가 '이대로 추가하기'로 확정.
      await runParse(transcript);
    } catch (e) {
      if (gen !== voiceGenRef.current) return;
      show(localizeApiError(e, intl, "formal"), "⚠️");
    } finally {
      if (gen === voiceGenRef.current) setListening(false);
    }
  };

  // ── AI 정리(파싱) — 활성 탭에 맞춰 텍스트/사진을 실제 파싱(자동 실행 금지) ──
  const handleParse = async () => {
    if (tab === "image") {
      if (!imagePreview) {
        show(intl.formatMessage({ id: "parent.aiSchedule.selectPhotoFirst" }), "📸");
        return;
      }
      // 가정통신문 사진 → voice-parse(image) 엔드포인트로 실제 파싱.
      await runParse("", imagePreview);
      return;
    }
    const t = text.trim();
    if (!t) {
      show(intl.formatMessage({ id: "parent.aiSchedule.enterContent" }), "✏️");
      return;
    }
    await runParse(t);
  };

  // ── 확정: 파싱된 일정 생성 — 사용자 버튼 onClick 에서만 호출(자동 실행 금지) ──
  const handleConfirm = async () => {
    if (!drafts || drafts.length === 0) return;
    if (!aiScheduleDataReady) {
      show(intl.formatMessage({ id: "parent.aiSchedule.dataNotReady" }), "⚠️");
      return;
    }
    if (status !== "authenticated" || !familyId) {
      show(intl.formatMessage({ id: "parent.aiSchedule.loginRequired" }), "🔒");
      return;
    }
    if (!activeChild) {
      show(intl.formatMessage({ id: "parent.aiSchedule.selectChildFirst" }), "⚠️");
      return;
    }
    if (!existingEvents.data) {
      show(intl.formatMessage({ id: "parent.aiSchedule.dataNotReady" }), "⚠️");
      return;
    }
    try {
      await createM.mutateAsync(buildAiScheduleSaveInputs(drafts, familyId, activeChild.id));
      show(
        drafts.length > 1
          ? intl.formatMessage(
              { id: "parent.aiSchedule.savedMany" },
              { count: intl.formatNumber(drafts.length) },
            )
          : intl.formatMessage(
              { id: "parent.aiSchedule.savedOne" },
              { title: drafts[0]?.title ?? "" },
            ),
        "✅",
      );
      setDrafts(null);
      setText("");
      setImagePreview(null);
      navigate(-1);
    } catch (e) {
      show(localizeApiError(e, intl, "formal"), "⚠️");
    }
  };

  if (aiScheduleQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={screenTitle}
        state="loading"
        heading={intl.formatMessage({ id: "parent.aiSchedule.loadingHeading" })}
        description={intl.formatMessage({ id: "parent.aiSchedule.loadingDescription" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (aiScheduleQueryState === "error" || aiScheduleDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={screenTitle}
        state="error"
        heading={intl.formatMessage({ id: "parent.aiSchedule.errorHeading" })}
        description={intl.formatMessage({ id: "parent.aiSchedule.errorDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryAiSchedule()}
        retrying={aiScheduleRefetching}
      />
    );
  }

  if (academyMode && !academyAllowed) {
    const academyReturnTo = "/ai-schedule?mode=academy&tab=image";
    return (
      <div className="ais-wrap">
        <header className="ais-header">
          <button
            type="button"
            className="ais-back hy-press"
            aria-label={intl.formatMessage({ id: "parent.aiSchedule.back" })}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={22} strokeWidth={2.2} color="currentColor" />
          </button>
          <span className="ais-title">{screenTitle}</span>
        </header>
        <section className="ais-body ais-academy-lock">
          <div className="ais-academy-lock__icon" aria-hidden="true">
            <Sparkles size={28} strokeWidth={2.2} />
          </div>
          <h1>{intl.formatMessage({ id: "parent.aiSchedule.academyLockTitle" })}</h1>
          <p>
            {intl.formatMessage(
              { id: "parent.aiSchedule.supplyLimit" },
              { limit: intl.formatNumber(MAX_SUPPLY_ITEMS_PER_KIND) },
            )}
          </p>
          <p className="ais-academy-lock__premium">
            {intl.formatMessage({ id: "parent.aiSchedule.academyPremiumDescription" })}
          </p>
          <button
            type="button"
            className="ais-confirm hy-press"
            onClick={() => setAcademyUpsellOpen(true)}
          >
            {intl.formatMessage({ id: "parent.aiSchedule.academyPremiumCta" })}
          </button>
          <button
            type="button"
            className="ais-academy-free hy-press"
            onClick={() => navigate("/ai-schedule?tab=text", { replace: true })}
          >
            {intl.formatMessage({ id: "parent.aiSchedule.freeScheduleCta" })}
          </button>
        </section>
        <PremiumUpsell
          open={academyUpsellOpen}
          source="academy_schedule"
          tier={entitlement.tier}
          returnTo={academyReturnTo}
          onClose={() => setAcademyUpsellOpen(false)}
          onUpgrade={({ source, feature, returnTo }) => {
            const storage = browserPremiumReturnIntentStorage();
            const saved = storage && returnTo
              ? savePremiumReturnIntent(storage, { source, feature, returnTo })
              : false;
            if (!saved) {
              throw new Error(intl.formatMessage({ id: "parent.aiSchedule.academyReturnFailed" }));
            }
            setAcademyUpsellOpen(false);
            navigate("/subscription");
          }}
        />
      </div>
    );
  }

  return (
    <div className="ais-wrap">
      <header className="ais-header">
        <button
          type="button"
          className="ais-back hy-press"
          aria-label={intl.formatMessage({ id: "parent.aiSchedule.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="currentColor" />
        </button>
        <span className="ais-title">{screenTitle}</span>
      </header>

      <div className="ais-body">
        {academyMode && (
          <div className="ais-academy-intro">
            <strong>{intl.formatMessage({ id: "parent.aiSchedule.academyIntroTitle" })}</strong>
            <span>{intl.formatMessage({ id: "parent.aiSchedule.academyIntroDescription" })}</span>
          </div>
        )}
        {aiScheduleDataEmpty && (
          <div className="sqs-inline-empty">
            {intl.formatMessage({ id: "parent.aiSchedule.empty" })}
          </div>
        )}
        {/* 입력 방식 탭 */}
        <div className="ais-tabs">
          {AI_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="ais-tab hy-press"
              data-active={tab === t.key}
              onClick={() => switchTab(t.key)}
            >
              <span className="ais-tab__emoji">
                <t.Icon size={15} strokeWidth={2.4} />
              </span>
              {intl.formatMessage({ id: t.messageId })}
            </button>
          ))}
        </div>

        {/* 음성 — 네이티브 SpeechRecognition(웹은 Web Speech API) 단발 인식 → AI 정리 */}
        {tab === "voice" && (
          <div className="ais-voice">
            <button
              type="button"
              className={listening ? "ais-mic ais-mic--on hy-press hy-busy-quiet" : "ais-mic hy-press hy-busy-quiet"}
              onClick={startVoice}
              disabled={parseM.isPending}
              aria-busy={parseM.isPending}
              aria-label={intl.formatMessage({
                id: parseM.isPending
                  ? "parent.aiSchedule.voiceParsingAria"
                  : listening
                    ? "parent.aiSchedule.voiceListeningAria"
                    : "parent.aiSchedule.voiceStartAria",
              })}
            >
              <span className="ais-mic__ring" />
              <span className="ais-mic__inner" />
              <img className="ais-mic__img" src={asset("ui/mic-lavender.webp")} alt="" />
            </button>
            <div className="ais-wave" data-on={listening ? "true" : "false"}>
              {WAVE_BARS.map((b) => (
                <span key={b.id} className="ais-wave__bar" style={{ animationDelay: b.delay }} />
              ))}
            </div>
            <div className="ais-listening">
              {listening
                ? intl.formatMessage({ id: "parent.aiSchedule.listening" })
                : text
                  ? intl.formatMessage({ id: "parent.aiSchedule.transcriptReady" })
                  : intl.formatMessage({ id: "parent.aiSchedule.voicePrompt" })}
            </div>
            {text ? (
              <div className="ais-bubble ais-bubble--said">“{text}”</div>
            ) : (
              <div className="ais-bubble">
                {intl.formatMessage({ id: "parent.aiSchedule.voiceExample" })}
              </div>
            )}
            <div className="ais-hint hy-explain">
              <span className="ais-hint__ico"><Mic size={15} strokeWidth={2.2} /></span>
              {intl.formatMessage({ id: "parent.aiSchedule.voiceHint" })}
            </div>
          </div>
        )}

        {/* 텍스트 — AI 파싱 실연결 경로 */}
        {tab === "text" && (
          <div className="ais-text">
            <div className="ais-textbox">
              <textarea
                className="ais-textarea"
                aria-label={intl.formatMessage({ id: "parent.aiSchedule.textAria" })}
                placeholder={intl.formatMessage({ id: "parent.aiSchedule.textPlaceholder" })}
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
              />
            </div>
            <div className="ais-hint hy-explain">
              <span className="ais-hint__ico"><Sparkles size={15} strokeWidth={2.2} /></span>
              {intl.formatMessage({ id: "parent.aiSchedule.textHint" })}
            </div>
          </div>
        )}

        {/* 사진 — 실제 파일 입력(선택·미리보기 동작) → voice-parse(image) 로 실제 파싱 */}
        {tab === "image" && (
          <div className="ais-image">
            {/* 숨긴 파일 입력: 촬영·갤러리 모두 열 수 있도록 capture 는 두지 않는다(디자인 문구 준수) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="ais-file"
              onChange={handleImageSelect}
            />
            <div className="ais-mode-intro">
              <div className="ais-mode-intro__title">
                {intl.formatMessage({
                  id: academyMode
                    ? "parent.aiSchedule.academyImageTitle"
                    : "parent.aiSchedule.noticeImageTitle",
                })}
              </div>
              <p>
                {academyMode
                  ? intl.formatMessage({ id: "parent.aiSchedule.academyImageDescription" })
                  : intl.formatMessage({ id: "parent.aiSchedule.noticeImageDescription" })}
              </p>
            </div>
            {imagePreview ? (
              <div className="ais-preview">
                <img
                  className="ais-preview__img"
                  src={imagePreview}
                  alt={intl.formatMessage({ id: "parent.aiSchedule.selectedImageAlt" })}
                />
                <button
                  type="button"
                  className="ais-preview__change hy-press"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {intl.formatMessage({ id: "parent.aiSchedule.changePhoto" })}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="ais-upload hy-press"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="ais-upload__icon">
                  <img src={asset("cat/study.webp")} alt="" />
                </span>
                <span className="ais-upload__text">
                  <span className="ais-upload__title">
                    {intl.formatMessage({ id: "parent.aiSchedule.selectPhoto" })}
                  </span>
                  <span className="ais-upload__sub">
                    {intl.formatMessage({ id: "parent.aiSchedule.photoKinds" })}
                  </span>
                </span>
              </button>
            )}
            <div className="ais-hint hy-explain">
              <span className="ais-hint__ico"><Camera size={15} strokeWidth={2.2} /></span>
              <span className="hy-explain__lines">
                <span className="hy-explain__line">
                  {intl.formatMessage({ id: "parent.aiSchedule.imageSearch" })}
                </span>
                <span className="hy-explain__line">
                  {intl.formatMessage({ id: "parent.aiSchedule.imageCredit" })}
                </span>
                <span className="hy-explain__line">
                  {intl.formatMessage({ id: "parent.aiSchedule.imageServer" })}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* AI 인식 결과 — 파싱 성공 시에만 노출(입력 전/실패 시 숨김) */}
        {hasResult && drafts && (
          <>
            <div className="ais-reslabel">
              <span className="ais-reslabel__badge"><Sparkles size={13} strokeWidth={2.2} color="var(--lav-text)" /></span>
              <span className="ais-reslabel__text">
                {count > 1
                  ? intl.formatMessage(
                      { id: "parent.aiSchedule.resultMany" },
                      { count: intl.formatNumber(count) },
                    )
                  : intl.formatMessage({ id: "parent.aiSchedule.resultOne" })}
              </span>
            </div>

            {drafts.map((draft) => (
              <div key={draft.id} className="ais-result">
                <div className="ais-result__top">
                  <span className="ais-result__icon">
                    <img
                      src={asset(resolveEventVisualAsset(draft.title, draft.category))}
                      alt=""
                    />
                  </span>
                  <span className="ais-result__info">
                    <span className="ais-result__k">
                      {intl.formatMessage({ id: "parent.aiSchedule.eventLabel" })}
                    </span>
                    <span className="ais-result__v ais-result__v--lg">{draft.title}</span>
                  </span>
                </div>
                <div className="ais-result__hr" />
                <div className="ais-result__grid">
                  <div className="ais-result__cell">
                    <span className="ais-result__k">
                      {intl.formatMessage({ id: "parent.aiSchedule.dateLabel" })}
                    </span>
                    <span className="ais-result__v">{draft.dateLabel}</span>
                  </div>
                  <div className="ais-result__cell">
                    <span className="ais-result__k">
                      {intl.formatMessage({ id: "parent.aiSchedule.timeLabel" })}
                    </span>
                    <span className="ais-result__v">{draft.timeLabel}</span>
                  </div>
                  <div className="ais-result__cell">
                    <span className="ais-result__k">
                      {intl.formatMessage({ id: "parent.aiSchedule.categoryLabel" })}
                    </span>
                    <span className="ais-result__v">
                      {intl.formatMessage({
                        id: CAT_MESSAGE_ID[draft.category] || CAT_MESSAGE_ID.other,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            <div className="ais-edit-note hy-explain">
              {activeChild
                ? intl.formatMessage(
                    { id: "parent.aiSchedule.assignedChild" },
                    {
                      count: intl.formatNumber(count),
                      childName: activeChild.name || intl.formatMessage({
                        id: "parent.aiSchedule.selectedChildFallback",
                      }),
                    },
                  )
                : intl.formatMessage({ id: "parent.aiSchedule.selectChildNote" })}
            </div>
          </>
        )}

        {/* 하단 액션: 결과 전 = AI 정리(파싱), 결과 후 = 확정 생성. 둘 다 사용자 버튼 클릭에서만 실행. */}
        {hasResult ? (
          <button
            type="button"
            className="ais-confirm hy-press"
            onClick={handleConfirm}
            disabled={createM.isPending}
            aria-busy={createM.isPending}
          >
            <Check size={20} strokeWidth={2.4} color="#fff" />
            {intl.formatMessage({
              id: createM.isPending
                ? "parent.aiSchedule.saving"
                : "parent.aiSchedule.confirm",
            })}
          </button>
        ) : (
          <button
            type="button"
            className="ais-confirm hy-press"
            onClick={handleParse}
            disabled={!canParse || parseM.isPending}
            aria-busy={parseM.isPending}
          >
            <Sparkles size={20} strokeWidth={2.4} color="#fff" />
            {parseM.isPending
              ? tab === "image"
                ? intl.formatMessage({ id: "parent.aiSchedule.searching" })
                : intl.formatMessage({ id: "parent.aiSchedule.parsing" })
              : tab === "image"
                ? intl.formatMessage({ id: "parent.aiSchedule.search" })
                : intl.formatMessage({ id: "parent.aiSchedule.parse" })}
          </button>
        )}
      </div>
      <PremiumUpsell
        open={scheduleLimitUpsellOpen}
        source="ai_schedule_limit"
        tier={entitlement.tier}
        returnTo={`/ai-schedule?tab=${tab}`}
        onClose={() => setScheduleLimitUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, { source, feature, returnTo })
            : false;
          if (!saved) {
            throw new Error(intl.formatMessage({ id: "parent.aiSchedule.returnFailed" }));
          }
          setScheduleLimitUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}
