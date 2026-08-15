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

type TabKey = "voice" | "text" | "image";

// 탭 아이콘 — 유니코드 이모지 대신 lucide 라인 아이콘(비싼 심플함 유지).
const AI_TABS: ReadonlyArray<{ key: TabKey; Icon: LucideIcon; label: string }> = [
  { key: "voice", Icon: Mic, label: "음성" },
  { key: "text", Icon: Keyboard, label: "텍스트" },
  { key: "image", Icon: ImageIcon, label: "사진" },
];

/** 음성 파형 막대 — 20개, 물결처럼 어긋난 delay. */
const WAVE_BARS = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  delay: `${(-((i * 7) % 11) * 0.09).toFixed(2)}s`,
}));

/** 카테고리(school/sports/...) → 결과 카드 라벨(hyeni-1 CATS 기준). */
const CAT_LABEL: Record<string, string> = {
  school: "학교·공부",
  sports: "운동",
  hobby: "취미",
  family: "가족",
  friend: "친구",
  other: "기타",
};

/** 오늘 기준 currentDate(month 는 0-indexed — voice-parse 상대 날짜 해석용). */
function currentDateParts(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

export function AiSchedule() {
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
        show("사진을 불러오지 못했어요", "⚠️");
        return;
      }
      setImagePreview(dataUrl);
      setDrafts(null); // 새 사진 → 이전 인식 결과 무효화.
    };
    reader.onerror = () => show("사진을 불러오지 못했어요", "⚠️");
    reader.readAsDataURL(file);
  };

  // ── AI 정리(파싱) 코어 — 텍스트/알림장 사진 공통. 사용자 버튼 onClick 에서만 호출 ──
  const runParse = async (payloadText: string, image?: string) => {
    if (!aiScheduleDataReady) {
      show("일정 정보를 확인한 뒤 다시 시도해 주세요.", "⚠️");
      return;
    }
    if (status !== "authenticated") {
      show("로그인이 필요해요", "🔒");
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
          image
            ? "사진에서 일정을 찾지 못했어요. 날짜와 시간이 잘 보이게 다시 찍어 주세요."
            : "일정을 찾지 못했어요. 날짜와 시간을 조금 더 자세히 적어 주세요.",
          "🤔",
        );
        return;
      }
      const prepared = buildAiScheduleDrafts(result.events, cd, () => crypto.randomUUID(), locale);
      if (prepared.error) {
        setDrafts(null);
        const errorMessage = prepared.error.code === "invalid_title"
          ? `AI가 ‘${prepared.error.title}’의 일정 이름을 읽지 못했어요. 이름을 포함해 다시 정리해 주세요.`
          : prepared.error.code === "invalid_date"
            ? `AI가 ‘${prepared.error.title}’ 일정의 날짜를 잘못 읽었어요. 날짜를 확인해 다시 정리해 주세요.`
            : `AI가 ‘${prepared.error.title}’ 일정의 시간을 잘못 읽었어요. 0시부터 23시 59분 사이로 다시 적어 주세요.`;
        show(errorMessage, "⚠️");
        return;
      }
      setDrafts(prepared.drafts);
    } catch (e) {
      setDrafts(null);
      if (!academyMode && e instanceof ApiError && e.status === 429 && e.message === "daily_limit_reached") {
        await entitlement.refetch().catch(() => undefined);
        setScheduleLimitUpsellOpen(true);
        return;
      }
      if (academyMode && e instanceof ApiError && e.message === "premium_required") {
        await entitlement.refetch().catch(() => undefined);
        setAcademyUpsellOpen(true);
        show("프리미엄 구독 상태를 다시 확인해 주세요.", "⚠️");
        return;
      }
      show(
        e instanceof ApiError
          ? e.message
          : image
            ? "AI 일정 등록을 사용할 수 없어요. 잠시 후 다시 시도해 주세요."
            : "일정 정리에 실패했어요",
        "⚠️",
      );
    }
  };

  // ── 음성 인식(STT) → 인식 텍스트를 그대로 AI 정리로 투입 ──
  // 네이티브 SpeechRecognition 플러그인 우선, 웹은 Web Speech API 폴백(@/lib/native/speech).
  const startVoice = async () => {
    if (!micArmedRef.current || listening || parseM.isPending) return;
    if (!aiScheduleDataReady) {
      show("일정 정보를 확인한 뒤 다시 시도해 주세요.", "⚠️");
      return;
    }
    if (status !== "authenticated") {
      show("로그인이 필요해요", "🔒");
      return;
    }
    if (!isSpeechCaptureSupported()) {
      show("이 기기는 음성 인식을 지원하지 않아요. 텍스트로 입력해 주세요.", "🎤");
      setTab("text");
      return;
    }
    const gen = ++voiceGenRef.current;
    setListening(true);
    setDrafts(null);
    try {
      const transcript = await captureSpeech("ko-KR");
      if (gen !== voiceGenRef.current) return; // 탭 전환·이탈로 취소된 인식 — 결과·토스트 무시
      if (!transcript) {
        show("음성을 인식하지 못했어요. 다시 말해 주세요.", "🎤");
        return;
      }
      setText(transcript);
      // 인식 성공 → 곧바로 AI 정리(결과 카드 표시). 실제 저장은 사용자가 '이대로 추가하기'로 확정.
      await runParse(transcript);
    } catch (e) {
      if (gen !== voiceGenRef.current) return;
      show(e instanceof Error ? e.message : "음성 인식에 실패했어요", "⚠️");
    } finally {
      if (gen === voiceGenRef.current) setListening(false);
    }
  };

  // ── AI 정리(파싱) — 활성 탭에 맞춰 텍스트/사진을 실제 파싱(자동 실행 금지) ──
  const handleParse = async () => {
    if (tab === "image") {
      if (!imagePreview) {
        show("먼저 사진을 선택해 주세요", "📸");
        return;
      }
      // 가정통신문 사진 → voice-parse(image) 엔드포인트로 실제 파싱.
      await runParse("", imagePreview);
      return;
    }
    const t = text.trim();
    if (!t) {
      show("정리할 내용을 입력해 주세요", "✏️");
      return;
    }
    await runParse(t);
  };

  // ── 확정: 파싱된 일정 생성 — 사용자 버튼 onClick 에서만 호출(자동 실행 금지) ──
  const handleConfirm = async () => {
    if (!drafts || drafts.length === 0) return;
    if (!aiScheduleDataReady) {
      show("일정 정보를 확인한 뒤 다시 시도해 주세요.", "⚠️");
      return;
    }
    if (status !== "authenticated" || !familyId) {
      show("로그인이 필요해요", "🔒");
      return;
    }
    if (!activeChild) {
      show("일정을 넣을 아이를 먼저 선택해 주세요", "⚠️");
      return;
    }
    if (!existingEvents.data) {
      show("일정 정보를 확인한 뒤 다시 시도해 주세요.", "⚠️");
      return;
    }
    try {
      await createM.mutateAsync(buildAiScheduleSaveInputs(drafts, familyId, activeChild.id));
      show(
        drafts.length > 1
          ? `${drafts.length}건의 일정을 캘린더에 추가했어요`
          : `‘${drafts[0]?.title ?? "일정"}’ 일정을 캘린더에 추가했어요`,
        "✅",
      );
      setDrafts(null);
      setText("");
      setImagePreview(null);
      navigate(-1);
    } catch (e) {
      show(e instanceof ApiError ? e.message : "일정 추가에 실패했어요", "⚠️");
    }
  };

  if (aiScheduleQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={academyMode ? "학원 시간표 정리" : "AI로 일정 추가"}
        state="loading"
        heading="일정 정보를 확인하고 있어요"
        description="가족 일정과 저장 준비 상태를 안전하게 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (aiScheduleQueryState === "error" || aiScheduleDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={academyMode ? "학원 시간표 정리" : "AI로 일정 추가"}
        state="error"
        heading="일정 추가 조건을 확인하지 못했어요"
        description="확인되지 않은 상태에서 AI 처리나 일정 저장이 시작되지 않도록 잠시 닫았어요."
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
            aria-label="뒤로"
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
          </button>
          <span className="ais-title">학원 시간표 정리</span>
        </header>
        <section className="ais-body ais-academy-lock">
          <div className="ais-academy-lock__icon" aria-hidden="true">
            <Sparkles size={28} strokeWidth={2.2} />
          </div>
          <h1>학원 시간표를 한 번에 정리해 보세요</h1>
          <p>직접 일정 추가와 기존 일정 관리는 무료에서도 제한 없이 사용할 수 있어요. 준비물과 숙제는 모든 플랜에서 아이별 하루 각각 {MAX_SUPPLY_ITEMS_PER_KIND}개까지 저장할 수 있어요.</p>
          <p className="ais-academy-lock__premium">
            프리미엄에서는 학원 시간표 사진을 여러 일정으로 정리하고, 저장 장소의 위치 흐름과 함께 관리할 수 있어요.
          </p>
          <button
            type="button"
            className="ais-confirm hy-press"
            onClick={() => setAcademyUpsellOpen(true)}
          >
            프리미엄으로 학원표 정리하기
          </button>
          <button
            type="button"
            className="ais-academy-free hy-press"
            onClick={() => navigate("/ai-schedule?tab=text", { replace: true })}
          >
            무료로 일반 일정 추가하기
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
            if (!saved) throw new Error("결제 후 학원 시간표 화면으로 돌아올 경로를 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
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
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ais-title">{academyMode ? "학원 시간표 정리" : "AI로 일정 추가"}</span>
      </header>

      <div className="ais-body">
        {academyMode && (
          <div className="ais-academy-intro">
            <strong>학원 시간표 자동 정리</strong>
            <span>주간 시간표나 학원 안내문을 올리면 여러 일정을 한 번에 확인해 캘린더에 저장해요.</span>
          </div>
        )}
        {aiScheduleDataEmpty && (
          <div className="sqs-inline-empty">
            아직 등록된 일정이 없어요. 아래에서 첫 일정을 정리해 보세요.
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
              {t.label}
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
              aria-label={parseM.isPending ? "일정 정리 중" : listening ? "듣는 중" : "말하기 시작"}
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
                ? "듣는 중… 지금 말해 보세요"
                : text
                  ? "인식된 내용이에요 · 아래에서 정리해요"
                  : "마이크를 누르고 말해 보세요"}
            </div>
            {text ? (
              <div className="ais-bubble ais-bubble--said">“{text}”</div>
            ) : (
              <div className="ais-bubble">예) “내일 오후 4시에 태권도 일정 추가해 줘”</div>
            )}
            <div className="ais-hint hy-explain">
              <span className="ais-hint__ico"><Mic size={15} strokeWidth={2.2} /></span>
              말한 내용에서 추가할 일정의 날짜와 시간을 정리해요
            </div>
          </div>
        )}

        {/* 텍스트 — AI 파싱 실연결 경로 */}
        {tab === "text" && (
          <div className="ais-text">
            <div className="ais-textbox">
              <textarea
                className="ais-textarea"
                aria-label="정리할 일정 내용"
                placeholder="예) 다음 주 화요일 4시 태권도와 목요일 5시 미술학원 추가해 줘"
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
              />
            </div>
            <div className="ais-hint hy-explain">
              <span className="ais-hint__ico"><Sparkles size={15} strokeWidth={2.2} /></span>
              자유롭게 적으면 AI가 추가할 일정의 날짜와 시간을 정리해요
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
                {academyMode ? "학원 시간표 사진으로 일정 찾기" : "가정통신문 사진으로 일정 찾기"}
              </div>
              <p>
                {academyMode
                  ? "주간 시간표나 학원 안내문에서 날짜와 시간을 찾아 여러 일정 후보로 정리해 드려요."
                  : "가정통신문, 알림장, 학원 안내문, 준비물 사진에서 날짜와 시간을 찾아드려요."}
              </p>
            </div>
            {imagePreview ? (
              <div className="ais-preview">
                <img className="ais-preview__img" src={imagePreview} alt="선택한 가정통신문 사진" />
                <button
                  type="button"
                  className="ais-preview__change hy-press"
                  onClick={() => fileInputRef.current?.click()}
                >
                  다른 사진 선택
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
                  <span className="ais-upload__title">사진 선택</span>
                  <span className="ais-upload__sub">가정통신문 · 알림장 · 학원 안내문</span>
                </span>
              </button>
            )}
            <div className="ais-hint hy-explain">
              <span className="ais-hint__ico"><Camera size={15} strokeWidth={2.2} /></span>
              <span className="hy-explain__lines">
                <span className="hy-explain__line">AI가 사진에서 일정을 찾습니다.</span>
                <span className="hy-explain__line">크레딧이 사용될 수 있어요.</span>
                <span className="hy-explain__line">사진은 일정 후보를 찾기 위해 서버로 전송돼요.</span>
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
                  ? `AI 인식 결과 · ${count}건을 모두 확인해 주세요`
                  : "AI 인식 결과 · 내용을 확인해 주세요"}
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
                    <span className="ais-result__k">일정</span>
                    <span className="ais-result__v ais-result__v--lg">{draft.title}</span>
                  </span>
                </div>
                <div className="ais-result__hr" />
                <div className="ais-result__grid">
                  <div className="ais-result__cell">
                    <span className="ais-result__k">날짜</span>
                    <span className="ais-result__v">{draft.dateLabel}</span>
                  </div>
                  <div className="ais-result__cell">
                    <span className="ais-result__k">시간</span>
                    <span className="ais-result__v">{draft.timeLabel}</span>
                  </div>
                  <div className="ais-result__cell">
                    <span className="ais-result__k">분류</span>
                    <span className="ais-result__v">{CAT_LABEL[draft.category] || CAT_LABEL.other}</span>
                  </div>
                </div>
              </div>
            ))}
            <div className="ais-edit-note hy-explain">
              {activeChild
                ? `${count}건 모두 ${activeChild.name || "선택한 아이"}에게 저장돼요. 추가한 뒤 캘린더에서 수정할 수 있어요.`
                : "저장할 아이를 먼저 선택해 주세요."}
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
            {createM.isPending ? "추가하는 중…" : "이대로 추가하기"}
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
                ? "찾는 중…"
                : "정리하는 중…"
              : tab === "image"
                ? "일정 찾기"
                : "AI로 정리하기"}
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
          if (!saved) throw new Error("결제 후 AI 일정 정리 화면으로 돌아올 경로를 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          setScheduleLimitUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}
