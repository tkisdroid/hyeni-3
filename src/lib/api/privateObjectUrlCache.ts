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
}

let generation = 0;
const entries = new Map<string, PrivateObjectUrlEntry>();

function revoke(url: string | null): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function retireEntry(key: string, entry: PrivateObjectUrlEntry): void {
  if (entry.retired) return;
  entry.retired = true;
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
): PrivateObjectUrlLease {
  const cached = entries.get(key);
  const entry = cached && cached.generation === generation && !cached.retired
    ? cached
    : createEntry(key, loader);
  entry.refs += 1;

  let released = false;
  return {
    url: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs === 0) retireEntry(key, entry);
    },
  };
}

export function clearPrivateObjectUrlCache(): void {
  generation += 1;
  for (const [key, entry] of entries) retireEntry(key, entry);
  entries.clear();
}
