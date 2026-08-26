export const STUDY_COPY_KO = {
  card: {
    title: "혜니스터디 학습관리",
    description: "아이의 수학 학습 현황과 연결 기기를 확인해요",
    checking: "확인 중",
    unavailable: "일시적으로 확인 불가",
    connect: "아이와 연결하기",
    completed: "오늘 학습 완료",
    view: "학습 현황 보기",
  },
  screen: {
    title: "학습관리",
    back: "뒤로 가기",
    introTitle: "아이별 수학 학습을 확인하세요",
    introDescription: "혜니스터디에서 푼 문제와 연결 상태를 아이별로 안전하게 보여드려요.",
    loading: "학습 정보를 불러오고 있어요",
    unavailableTitle: "학습 정보를 확인할 수 없어요",
    unavailableDescription: "잠시 후 다시 시도해 주세요.",
    disabledTitle: "학습관리를 준비하고 있어요",
    disabledDescription: "서비스가 열리면 이 화면에서 바로 확인할 수 있어요.",
    emptyTitle: "연결된 아이가 없어요",
    emptyDescription: "가족에 아이를 먼저 연결해 주세요.",
    retry: "다시 시도",
    linked: "연결됨",
    unlinked: "연결 필요",
  },
} as const;

export function studyCardStatusKo(input: Readonly<{
  featureState: "disabled" | "ready" | "unavailable" | undefined;
  loading: boolean;
  linked: boolean;
  todayProblemCount: number;
  completedToday: boolean;
}>): string {
  if (input.loading || input.featureState === undefined) return STUDY_COPY_KO.card.checking;
  if (input.featureState === "unavailable") return STUDY_COPY_KO.card.unavailable;
  if (!input.linked) return STUDY_COPY_KO.card.connect;
  if (input.todayProblemCount > 0) return `${input.todayProblemCount}문제 풀었어요`;
  if (input.completedToday) return STUDY_COPY_KO.card.completed;
  return STUDY_COPY_KO.card.view;
}
