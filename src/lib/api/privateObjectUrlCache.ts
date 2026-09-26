export interface PrivateObjectUrlLease {
  readonly url: Promise<string | null>;
  release(): void;
}

interface PrivateObjectUrlEntry {
  generation: number;
  refs: number;
  retired: boolean;
  resolvedUrl: string | null;
  controller: AbortController;
  promise: Promise<string | null>;
  /** 마지막 소비자가 떠난 뒤 회수를 미루는 타이머(retainMs 를 준 키만). */
  retainTimer: ReturnType<typeof setTimeout> | null;
}

let generation = 0;
const entries = new Map<string, PrivateObjectUrlEntry>();

function revoke(url: string | null): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function retireEntry(key: string, entry: PrivateObjectUrlEntry): void {
  if (entry.retired) return;
  entry.retired = true;
  if (entry.retainTimer) {
    clearTimeout(entry.retainTimer);
    entry.retainTimer = null;
  }
  if (entries.get(key) === entry) entries.delete(key);
  entry.controller.abort();
  if (entry.resolvedUrl) {
    revoke(entry.resolvedUrl);
    entry.resolvedUrl = null;
  }
  // signal을 무시한 loader가 늦게 끝나도 promise 완료 경로가 새 URL을 즉시 회수한다.
}

function createEntry(
  key: string,
  loader: (signal: AbortSignal) => Promise<string>,
): PrivateObjectUrlEntry {
  const controller = new AbortController();
  const entry: PrivateObjectUrlEntry = {
    generation,
    refs: 0,
    retired: false,
    resolvedUrl: null,
    controller,
    promise: Promise.resolve(null),
    retainTimer: null,
  };
  entry.promise = Promise.resolve()
    .then(() => loader(controller.signal))
    .then((url) => {
      if (entry.retired || generation !== entry.generation) {
        revoke(url);
        return null;
      }
      entry.resolvedUrl = url;
      return url;
    })
    .catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      if (entry.retired || generation !== entry.generation) return null;
      throw error;
    });
  entries.set(key, entry);
  return entry;
}

/**
 * 비공개 객체 URL의 공유 lease를 얻는다.
 * 같은 키의 동시 요청은 하나로 합치고 마지막 소비자가 release하면 blob URL을 즉시 회수한다.
 */
export function acquirePrivateObjectUrl(
  key: string,
  loader: (signal: AbortSignal) => Promise<string>,
  options: { retainMs?: number } = {},
): PrivateObjectUrlLease {
  const cached = entries.get(key);
  const entry = cached && cached.generation === generation && !cached.retired
    ? cached
    : createEntry(key, loader);
  if (entry.retainTimer) {
    clearTimeout(entry.retainTimer);
    entry.retainTimer = null;
  }
  entry.refs += 1;
  const retainMs = Math.max(0, options.retainMs ?? 0);

  let released = false;
  return {
    url: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs !== 0) return;
      // 가족 프로필 사진처럼 화면을 오갈 때마다 다시 받으면 기본 캐릭터가 잠깐 보였다가 바뀌는 키는
      // 받아 둔 URL 만 잠시 더 둔다(2026-09-26 Safari: 설정 진입마다 보호자 사진이 사라졌다 나타남).
      // 아직 받는 중인 요청과 세션 교체(clearPrivateObjectUrlCache)는 지금처럼 즉시 회수한다.
      if (retainMs > 0 && entry.resolvedUrl) {
        entry.retainTimer = setTimeout(() => {
          entry.retainTimer = null;
          if (entry.refs === 0) retireEntry(key, entry);
        }, retainMs);
        return;
      }
      retireEntry(key, entry);
    },
  };
}

/** 이미 받아 둔 URL 이 있으면 바로 돌려준다(첫 렌더에서 기본 이미지를 거치지 않게). */
export function peekPrivateObjectUrl(key: string): string | null {
  const entry = entries.get(key);
  if (!entry || entry.retired || entry.generation !== generation) return null;
  return entry.resolvedUrl;
}

export function clearPrivateObjectUrlCache(): void {
  generation += 1;
  for (const [key, entry] of entries) retireEntry(key, entry);
  entries.clear();
}
