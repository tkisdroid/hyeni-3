import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useAiFriendPublicSettings, useSetAiFriendName } from "@/queries/useAi";
import { resolveAiFriendDisplayName } from "@/transform/aiFriendName";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./AiFriendSetup.css";

/**
 * AI 친구 페르소나(hyeni-1 aiChatPersonas ANIMAL_CHAT_PERSONAS 1:1 이관).
 * tone/trait/greeting/name 은 Worker(ai-child-chat) PERSONAS 와 동일해야 한다(프롬프트 정본은 서버).
 * animal 은 public/assets/animal/*.webp 파일명 — 이미지 있는 6종만 노출한다(🐥/🐯 자산 없음).
 */
export interface FriendPersona {
  emoji: string;
  name: string;
  species: string;
  tone: string;
  greeting: string;
  animal: string;
}

export const AI_FRIEND_PERSONAS: FriendPersona[] = [
  { emoji: "🐰", name: "통통이", species: "토끼", tone: "활발하고 친근한", greeting: "안녕! 나 통통이야. 오늘은 뭐가 궁금해?", animal: "rabbit" },
  { emoji: "🐱", name: "야옹이", species: "고양이", tone: "장난스럽고 재미있는", greeting: "야옹~ 나는 야옹이야! 오늘 재밌는 일 있었어?", animal: "cat" },
  { emoji: "🦊", name: "꼬미", species: "여우", tone: "깜찍하고 귀여운", greeting: "헤헤, 나는 꼬미야! 같이 얘기하자, 응?", animal: "fox" },
  { emoji: "🐶", name: "멍이", species: "강아지", tone: "씩씩하고 충직한", greeting: "왈! 나는 멍이야. 내가 항상 네 편이야!", animal: "dog" },
  { emoji: "🐻", name: "곰돌이", species: "곰", tone: "포근하고 든든한", greeting: "안녕, 나는 곰돌이야. 오늘도 잘 지냈어?", animal: "bear" },
  { emoji: "🐼", name: "푸푸", species: "판다", tone: "평화롭고 순한", greeting: "안녕, 나는 푸푸야. 마음이 편해지는 이야기 해줄게.", animal: "panda" },
];

export const DEFAULT_CHARACTER = "🐰";

/** 이모지 → 페르소나(없으면 기본 토끼). */
export function personaFor(emoji: string | null | undefined): FriendPersona {
  return AI_FRIEND_PERSONAS.find((p) => p.emoji === emoji) ?? AI_FRIEND_PERSONAS[0];
}

// ── 선택 캐릭터 로컬 저장 ──────────────────────────────────────────────────
// family_members.emoji 쓰기 엔드포인트가 (이 도메인엔) 없어 캐릭터 선택은 이 기기에 저장하고
// 채팅 요청의 characterEmoji 로 전달한다. 서버 페르소나(이름 등)는 friend-name 으로 별도 저장.
const CHAR_KEY_PREFIX = "hyeni3-ai-friend-character";

function characterStorageKey(familyId?: string | null, childUserId?: string | null): string {
  if (!familyId || !childUserId) return "";
  return `${CHAR_KEY_PREFIX}:${familyId}:${childUserId}`;
}

/** 저장된 선택 캐릭터(유효 이모지만). 없으면 "". */
export function readSelectedCharacter(familyId?: string | null, childUserId?: string | null): string {
  const key = characterStorageKey(familyId, childUserId);
  if (!key || typeof window === "undefined") return "";
  try {
    const value = window.localStorage.getItem(key);
    return AI_FRIEND_PERSONAS.some((p) => p.emoji === value) ? (value as string) : "";
  } catch {
    return "";
  }
}

/** 선택 캐릭터 저장(이 기기 기준). localStorage 차단 환경은 조용히 무시. */
export function writeSelectedCharacter(
  familyId: string | null | undefined,
  childUserId: string | null | undefined,
  emoji: string,
): void {
  const key = characterStorageKey(familyId, childUserId);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, emoji);
  } catch {
    /* 이 기기 저장만 실패 — 채팅 전달은 navigate state 로 이어진다. */
  }
}

const MAX_NAME_LEN = 30;

export function AiFriendSetup() {
  const navigate = useNavigate();
  const { show } = useToast();

  // 아이 모드: 로그인 사용자 = 아이. childUserId = userId.
  const { familyId, userId } = useAuth();
  const familyQuery = useMyFamily();
  const publicSettingsQuery = useAiFriendPublicSettings(userId);
  const family = familyQuery.data;
  const publicSettings = publicSettingsQuery.data;
  const aiFriendSetupQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: publicSettingsQuery.isLoading, isError: publicSettingsQuery.isError },
  ]);
  const aiFriendSetupDataMissing = aiFriendSetupQueryState === "ready" && (
    !family || publicSettings === undefined
  );
  const aiFriendSetupDataReady = aiFriendSetupQueryState === "ready" && !aiFriendSetupDataMissing;
  const aiFriendSetupDataEmpty = aiFriendSetupDataReady && publicSettings === null;
  const aiFriendSetupRefetching = familyQuery.isFetching || publicSettingsQuery.isFetching;
  const retryAiFriendSetup = async (): Promise<void> => {
    await Promise.all([familyQuery.refetch(), publicSettingsQuery.refetch()]);
  };
  const setNameMutation = useSetAiFriendName();

  const [selected, setSelected] = useState<string>(
    () => readSelectedCharacter(familyId, userId) || DEFAULT_CHARACTER,
  );
  // null = 사용자가 직접 고치지 않음(서버 이름/페르소나 기본을 따름).
  const [customName, setCustomName] = useState<string | null>(null);

  const persona = personaFor(selected);
  const serverName = publicSettings?.ai_friend_name || "";
  const childMember = userId
    ? family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null
    : null;
  const childName = childMember?.name ?? "";
  const effectiveName =
    customName != null
      ? customName
      : resolveAiFriendDisplayName({ savedName: serverName, childName, fallbackName: persona.name });

  // 저장된 캐릭터가 뒤늦게 로드되면(로컬 우선) 초기 선택을 한 번 맞춘다.
  useEffect(() => {
    const stored = readSelectedCharacter(familyId, userId);
    if (stored) setSelected(stored);
  }, [familyId, userId]);

  const save = () => {
    if (!aiFriendSetupDataReady || !childMember || !familyId || !userId || setNameMutation.isPending) {
      show("내 가족과 AI 친구 설정을 확인한 뒤 다시 해줘", "⚠️");
      return;
    }
    writeSelectedCharacter(familyId, userId, selected);
    const finalName = (effectiveName || persona.name).trim().slice(0, MAX_NAME_LEN);
    const goChat = () =>
      navigate("/child/ai-friend", { state: { characterEmoji: selected, friendName: finalName } });

    // 이름이 서버값과 다르면 자녀 본인 write(friend-name). 실패해도 대화는 이어간다.
    if (finalName && finalName !== serverName) {
      setNameMutation.mutate(finalName, {
        onSuccess: () => goChat(),
        onError: () => {
          show("이름은 저장 못 했지만 대화는 할 수 있어!", "💜");
          goChat();
        },
      });
    } else {
      goChat();
    }
  };

  if (aiFriendSetupQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="내 AI 친구"
        state="loading"
        heading="내 AI 친구를 불러오고 있어"
        description="저장한 이름과 가족 연결을 확인하는 중이야."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (aiFriendSetupQueryState === "error" || aiFriendSetupDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="내 AI 친구"
        state="error"
        heading="AI 친구 설정을 불러오지 못했어"
        description="저장한 이름을 덮어쓰지 않도록 잠깐 닫았어. 다시 확인해 줘."
        onBack={() => navigate(-1)}
        onRetry={() => void retryAiFriendSetup()}
        retrying={aiFriendSetupRefetching}
        retryLabel="다시 확인하기"
        retryingLabel="다시 확인하고 있어…"
      />
    );
  }

  if (!childMember) {
    return (
      <ScreenQueryState
        screenTitle="내 AI 친구"
        state="empty"
        heading="내 가족 연결을 찾지 못했어"
        description="부모님과 다시 연결하면 AI 친구를 고를 수 있어."
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/onboarding")}
        retryLabel="연결 화면으로 가기"
      />
    );
  }

  return (
    <div className="afs">
      <header className="afs-header">
        <button
          type="button"
          className="afs-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--hy-accent-text)" />
        </button>
        <span className="afs-title">내 AI 친구</span>
      </header>

      <div className="afs-body">
        {aiFriendSetupDataEmpty && (
          <div className="sqs-inline-empty">
            아직 저장한 AI 친구 이름이 없어. 마음에 드는 친구부터 골라 봐.
          </div>
        )}
        {/* 선택한 친구 미리보기 */}
        <div className="afs-preview">
          <div className="afs-preview__art">
            <img src={asset(`animal/${persona.animal}.webp`)} alt="" />
          </div>
          <div className="afs-preview__name">{effectiveName}</div>
          <div className="afs-preview__tone">{persona.tone} {persona.species}</div>
        </div>

        {/* 캐릭터 고르기 */}
        <div className="afs-label">친구 고르기</div>
        <div className="afs-grid">
          {AI_FRIEND_PERSONAS.map((p) => (
            <button
              key={p.emoji}
              type="button"
              className={`afs-cell hy-press${p.emoji === selected ? " afs-cell--on" : ""}`}
              aria-pressed={p.emoji === selected}
              onClick={() => setSelected(p.emoji)}
            >
              <img src={asset(`animal/${p.animal}.webp`)} alt={p.name} />
            </button>
          ))}
        </div>

        {/* 이름 짓기 */}
        <div className="afs-label">이름 짓기</div>
        <input
          className="afs-name-field"
          value={effectiveName}
          aria-label="AI 친구 이름"
          maxLength={MAX_NAME_LEN}
          placeholder={persona.name}
          onChange={(e) => setCustomName(e.target.value)}
        />

        {/* 성격 · 말투(친구를 고르면 정해져) */}
        <div className="afs-label">성격 · 말투</div>
        <div className="afs-traits">
          <span className="afs-chip afs-chip--on">
            {persona.tone}
            <Check size={16} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="afs-trait-hint">친구를 고르면 성격이 정해져</span>
        </div>

        <button
          type="button"
          className="afs-cta hy-press"
          onClick={save}
          disabled={setNameMutation.isPending} aria-busy={setNameMutation.isPending}
        >
          {setNameMutation.isPending ? "저장 중…" : "저장하고 대화하기"}
        </button>
      </div>
    </div>
  );
}
