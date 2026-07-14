import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ChevronLeft, Check, Sparkles, Mic, Keyboard, Image as ImageIcon, type LucideIcon } from "lucide-react";
import { asset } from "@/lib/assets";
import { resolveEventVisualAsset } from "@/transform/placeVisual";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useParseSchedule } from "@/queries/useAi";
import { useEvents, useSaveEventsWithChildrenBatch } from "@/queries/useSchedule";
import { useEntitlement } from "@/queries/useEntitlement";
import { useActiveChild } from "@/app/activeChild";
import {
  buildAiScheduleDrafts,
  buildAiScheduleSaveInputs,
  type AiScheduleDraft,
} from "@/transform/aiScheduleDraft";
import { scheduleLimitFor, TIERS } from "@/transform/tierPolicy";
import { ApiError } from "@/lib/api/errors";
import { captureSpeech, isSpeechCaptureSupported } from "@/lib/native/speech";
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

function scheduleLimitMessage(tier: string, limit: number): string {
  if (tier === TIERS.FREE) {
    return "무료 플랜에서는 일정 1개까지 저장할 수 있어요. 스토어 방문 혜택을 받으면 3개, 프리미엄에서는 무제한으로 저장할 수 있어요.";
  }
  if (tier === TIERS.REVIEWED) {
    return "스토어 방문 혜택으로 일정 3개까지 저장할 수 있어요. 프리미엄에서는 무제한으로 저장할 수 있어요.";
  }
  return `현재 플랜에서는 일정 ${limit}개까지 저장할 수 있어요`;
}

export function AiSchedule() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { status, familyId } = useAuth();
  const parseM = useParseSchedule();
  const createM = useSaveEventsWithChildrenBatch();
  const { activeChild } = useActiveChild();
  const existingEvents = useEvents();
  const { tier } = useEntitlement();

  const [tab, setTab] = useState<TabKey>("voice");
  const [text, setText] = useState("");
  // 알림장 사진 미리보기(data URI). null = 사진 미선택.
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // 검증된 파싱 결과(미리보기). UUID도 이 시점에 확정해 저장 재시도에서 유지한다.
  const [drafts, setDrafts] = useState<AiScheduleDraft[] | null>(null);
  // 음성 인식 진행 중 여부.
  const [listening, setListening] = useState(false);
  // 숨긴 파일 입력 — 업로드 버튼 onClick 에서 트리거(직접 노출하지 않음).
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (status !== "authenticated") {
      show("로그인이 필요해요", "🔒");
      return;
    }
    try {
      const result = await parseM.mutateAsync({
        text: payloadText,
        ...(image ? { image } : {}),
        mode: "paste",
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
      const prepared = buildAiScheduleDrafts(result.events, cd, () => crypto.randomUUID());
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
    if (listening || parseM.isPending) return;
    if (status !== "authenticated") {
      show("로그인이 필요해요", "🔒");
      return;
    }
    if (!isSpeechCaptureSupported()) {
      show("이 기기는 음성 인식을 지원하지 않아요. 텍스트로 입력해 주세요.", "🎤");
      setTab("text");
      return;
    }
    setListening(true);
    setDrafts(null);
    try {
      const transcript = await captureSpeech("ko-KR");
      if (!transcript) {
        show("음성을 인식하지 못했어요. 다시 말해 주세요.", "🎤");
        return;
      }
      setText(transcript);
      // 인식 성공 → 곧바로 AI 정리(결과 카드 표시). 실제 저장은 사용자가 '이대로 추가하기'로 확정.
      await runParse(transcript);
    } catch (e) {
      show(e instanceof Error ? e.message : "음성 인식에 실패했어요", "⚠️");
    } finally {
      setListening(false);
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
      show("정리할 내용을 입력해주세요", "✏️");
      return;
    }
    await runParse(t);
  };

  // ── 확정: 파싱된 일정 생성 — 사용자 버튼 onClick 에서만 호출(자동 실행 금지) ──
  const handleConfirm = async () => {
    if (!drafts || drafts.length === 0) return;
    if (status !== "authenticated" || !familyId) {
      show("로그인이 필요해요", "🔒");
      return;
    }
    if (!activeChild) {
      show("일정을 넣을 아이를 먼저 선택해 주세요", "⚠️");
      return;
    }
    if (tier !== TIERS.UNKNOWN) {
      const limit = scheduleLimitFor(tier);
      const currentCount = existingEvents.data?.length ?? 0;
      if (currentCount + drafts.length > limit) {
        show(scheduleLimitMessage(tier, limit), "👑");
        return;
      }
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
        <span className="ais-title">AI로 일정 추가</span>
      </header>

      <div className="ais-body">
        {/* 입력 방식 탭 */}
        <div className="ais-tabs">
          {AI_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="ais-tab hy-press"
              data-active={tab === t.key}
              onClick={() => setTab(t.key)}
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
              className={listening ? "ais-mic ais-mic--on hy-press" : "ais-mic hy-press"}
              onClick={startVoice}
              disabled={parseM.isPending}
              aria-label={listening ? "듣는 중" : "말하기 시작"}
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
                ? "듣는 중… 지금 말해보세요"
                : text
                  ? "인식된 내용이에요 · 아래에서 정리해요"
                  : "마이크를 누르고 말해보세요"}
            </div>
            {text ? (
              <div className="ais-bubble ais-bubble--said">“{text}”</div>
            ) : (
              <div className="ais-bubble">예) “내일 오후 4시에 태권도 일정 추가해줘”</div>
            )}
            <div className="ais-hint">
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
                placeholder="예) 다음 주 화요일 4시 태권도와 목요일 5시 미술학원 추가해줘"
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
              />
            </div>
            <div className="ais-hint">
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
              <div className="ais-mode-intro__title">가정통신문 사진으로 일정 찾기</div>
              <p>가정통신문, 알림장, 학원 안내문, 준비물 사진에서 날짜와 시간을 찾아드려요.</p>
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
            <div className="ais-hint">
              <span className="ais-hint__ico"><Camera size={15} strokeWidth={2.2} /></span>
              AI가 사진에서 일정을 찾습니다. 크레딧이 사용될 수 있어요. 사진은 일정 후보를 찾기 위해 서버로 전송돼요.
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
            <div className="ais-edit-note">
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
          >
            <Check size={20} strokeWidth={2.4} color="#fff" />
            {createM.isPending ? "추가하는 중..." : "이대로 추가하기"}
          </button>
        ) : (
          <button
            type="button"
            className="ais-confirm hy-press"
            onClick={handleParse}
            disabled={!canParse || parseM.isPending}
          >
            <Sparkles size={20} strokeWidth={2.4} color="#fff" />
            {parseM.isPending
              ? tab === "image"
                ? "찾는 중..."
                : "정리하는 중..."
              : tab === "image"
                ? "일정 찾기"
                : "AI로 정리하기"}
          </button>
        )}
      </div>
    </div>
  );
}
