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
    unlinkedDescription: "아직 연결된 학습기록이 없어요.",
  },
  tabs: {
    label: "확인할 아이 선택",
    chooseTitle: "아이를 선택해 주세요",
    chooseDescription: "학습 현황을 확인할 아이를 직접 선택해 주세요.",
  },
  report: {
    title: "최근 학습 리포트",
    range7d: "최근 7일",
    gradeUnset: "학년 미설정",
    todayProblems: "오늘 푼 문제",
    accuracy: "정답률",
    reviewDue: "복습할 문제",
    lastStudied: "마지막 학습",
    mastery: "개념별 이해도",
    recentSessions: "최근 학습 기록",
    noMastery: "아직 표시할 개념 학습 기록이 없어요.",
    noSessions: "아직 최근 학습 기록이 없어요.",
    noRecord: "기록 없음",
    problemUnit: "문제",
  },
  devices: {
    title: "연결된 학습 기기",
    countUnit: "대",
    empty: "연결된 학습 기기가 없어요.",
    deviceLabel: "학습 기기",
    lastUsed: "마지막 사용",
    unknownTime: "확인할 수 없음",
    revoke: "기기 연결 해제",
    confirmDescription: "의 연결을 해제할까요? 현재 학습 기록은 그대로 보존돼요.",
    confirm: "연결 해제 확인",
    cancel: "취소",
    revoking: "해제 중",
    primaryOnly: "기기 연결 변경은 주 보호자만 할 수 있어요.",
    revokeFailed: "기기 연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.",
  },
  pairing: {
    title: "학습 기기 연결",
    description: "의 학습 기기를 QR로 연결할 수 있어요.",
    primaryOnly: "새 학습 기기 연결은 주 보호자만 할 수 있어요.",
    issue: "연결 QR 만들기",
    issuing: "QR 만드는 중",
    qrLabel: "혜니스터디 학습 기기 연결 QR",
    qrFailed: "QR을 만들지 못했어요",
    qrFailedLabel: "학습 기기 연결 QR 생성 실패",
    expires: "10분 동안 한 번만 사용할 수 있어요",
    scanDescription: "연결할 기기에서 혜니스터디를 열고 이 QR을 스캔해 주세요.",
    failed: "연결 QR을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
  },
  claim: {
    title: "기존 학습기록 연결",
    confirmOne: "이 아이에게 기존 혜니스터디 학습기록을 연결할까요?",
    chooseChild: "학습기록을 연결할 아이를 직접 선택해 주세요.",
    chooseLabel: "학습기록을 연결할 아이 선택",
    targetSuffix: "에게 학습기록을 연결합니다.",
    connect: "학습기록 연결",
    connecting: "연결 중",
    cancel: "취소",
    successTitle: "학습기록을 연결했어요",
    successDescription: "기존 기록을 안전하게 합쳤어요.",
    preserved: "보존된 풀이 기록",
    problemUnit: "개",
    viewReport: "학습 리포트 보기",
    unavailableTitle: "학습기록을 연결할 수 없어요",
    expired: "연결 링크가 만료되었거나 이미 사용되었어요.",
    primaryOnly: "기존 학습기록 연결은 주 보호자만 할 수 있어요.",
    failed: "학습기록을 연결하지 못했어요. 새 링크로 다시 시도해 주세요.",
    back: "학습관리로 돌아가기",
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
