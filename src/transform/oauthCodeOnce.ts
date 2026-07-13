/**
 * OAuth 인가코드 1회 소비 보장.
 *
 * 왜 필요한가(2026-07-10 실기기 실측):
 *   네이티브 콜드 스타트에서 같은 딥링크가 두 경로로 들어온다.
 *     ① App.getLaunchUrl()  — 실행 인텐트. 이후에도 계속 같은 URL 을 반환한다(휘발되지 않음).
 *     ② App.appUrlOpen      — 같은 인텐트의 이벤트.
 *   그래서 인가코드 1개가 2~3회 교환됐다. 인가코드는 1회용이라 구글은 재사용을 감지하면
 *   그 코드로 발급된 토큰을 모두 무효화한다 → 로그인 실패(카카오는 먼저 도착한 요청만 성공).
 *
 * 여기서는 provider:state 를 키로 삼아 인가코드 원문을 영속 저장하지 않는다.
 *   - 진행 중이면 같은 Promise 를 공유하고(동시 진입),
 *   - 이미 시도한 키는 다시 실행하지 않으며(재진입),
 *   - 시도 사실을 즉시 영속화해 프로세스 재시작 뒤 stale launch URL 재교환도 막는다.
 *
 * 실행 전에 기록하는 이유: 코드는 provider 에 도달하는 순간 소모된다. 실패 후 재시도해도
 * 어차피 거부되므로, 기록을 미루면 재시작 때 죽은 코드로 또 실패 토스트만 띄운다.
 */

export interface OAuthOnceStore {
  read(): readonly string[];
  write(keys: readonly string[]): void;
}

/** 영속 목록 상한 — 최근 것만 있으면 충분(무한 증가 방지). */
export const OAUTH_ONCE_HISTORY = 5;

export interface OAuthCodeOnce {
  /** key 가 처음이면 exec 실행, 아니면 재실행 없이 이전 결과(또는 skip)를 돌려준다. */
  run(key: string, exec: () => Promise<boolean>): Promise<boolean>;
  /** 이미 소비된 키인지(테스트·진단용). */
  consumed(key: string): boolean;
}

export function oauthStateKey(provider: string, state: string): string {
  return `${provider}:${state}`;
}

export function createOAuthCodeOnce(store: OAuthOnceStore): OAuthCodeOnce {
  const inflight = new Map<string, Promise<boolean>>();

  return {
    consumed(key) {
      return inflight.has(key) || store.read().includes(key);
    },
    run(key, exec) {
      const running = inflight.get(key);
      if (running) return running;
      if (store.read().includes(key)) return Promise.resolve(false);

      // 실행 직전에 영속화 — 이후 프로세스에서 같은 코드가 다시 들어와도 교환하지 않는다.
      store.write([...store.read(), key].slice(-OAUTH_ONCE_HISTORY));

      const p = exec();
      inflight.set(key, p);
      return p;
    },
  };
}

/** localStorage 백엔드(웹/WebView 공용). 접근 불가 환경에선 메모리처럼 동작한다. */
export function localStorageOAuthOnceStore(key: string): OAuthOnceStore {
  let memo: string[] | null = null;
  return {
    read() {
      if (memo) return memo;
      try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        memo = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
      } catch {
        memo = [];
      }
      return memo;
    },
    write(keys) {
      memo = [...keys];
      try {
        window.localStorage.setItem(key, JSON.stringify(memo));
      } catch {
        /* 메모리 캐시만 유지 */
      }
    },
  };
}
