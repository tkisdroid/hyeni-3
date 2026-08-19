/**
 * 플로팅 버튼 → 대화 화면으로 이어지는 전환의 정본(순수 계산, 2026-08-19 TK 제보).
 *
 * 왜 필요한가: 꾹 누르면 곧바로 다른 화면으로 잘려 넘어가 **흐름이 끊겨 보였다**.
 * 친구를 만나러 가는 건데 화면이 툭 바뀌면 "이동"이지 "대화 시작"이 아니다.
 * 그래서 두 단계로 이어 붙인다.
 *
 *  ① 버튼이 있던 자리에서 커지며 화면 가운데로 온다(`AI_BUDDY_LAUNCH_MS`).
 *  ② 대화 화면이 그 크기·자리에서 이어받아 제자리로 줄어들고 내용이 따라 올라온다(`AI_BUDDY_ENTER_MS`).
 *
 * 두 단계의 시작·끝 크기가 같아야 한 동작으로 읽히므로 크기·시간을 **여기 한 곳**에 둔다.
 * 화면이 각자 숫자를 들고 있으면 한쪽만 바뀌어 중간에 툭 튀는 전환이 된다.
 */

/** ① 버튼이 커지며 가운데로 가는 시간(ms). */
export const AI_BUDDY_LAUNCH_MS = 300;
/** ② 대화 화면이 이어받아 자리를 잡는 시간(ms). */
export const AI_BUDDY_ENTER_MS = 460;
/** 두 단계가 맞물리는 얼굴 크기(px). ①의 끝 = ②의 시작. */
export const AI_BUDDY_HANDOFF_FACE_PX = 168;

/**
 * 지금 전환 동작을 보여도 되는지.
 * 움직임 줄이기를 켠 아이에게는 커지는 연출 없이 곧바로 대화창을 연다(기능은 그대로).
 */
export function shouldAnimateAiBuddyLaunch(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

/** 대화 화면으로 넘어가기 전에 기다릴 시간(ms). 연출을 끄면 0 이다(지연 없음). */
export function aiBuddyLaunchDelayMs(reducedMotion: boolean): number {
  return shouldAnimateAiBuddyLaunch(reducedMotion) ? AI_BUDDY_LAUNCH_MS : 0;
}

/** 대화 화면이 이어받는 연출 시간(ms). 연출을 끄면 0 이다. */
export function aiBuddyEnterDurationMs(reducedMotion: boolean): number {
  return shouldAnimateAiBuddyLaunch(reducedMotion) ? AI_BUDDY_ENTER_MS : 0;
}
