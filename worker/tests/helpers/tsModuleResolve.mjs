/**
 * Worker 소스를 Node 네이티브 TypeScript 로딩으로 import 하기 위한 resolve 훅.
 *
 * Worker 소스는 wrangler(esbuild)가 번들하므로 상대 import에 확장자를 쓰지 않는다
 * (`from "../lib/corsOrigin"`). Node ESM은 확장자를 요구하므로 그대로는 로드되지 않는다.
 *
 * 과거에는 이 간극을 Vite dev server(`ssrLoadModule`)로 메웠지만, 앱 저장소 루트에서
 * 모듈 그래프를 SSR 변환하느라 테스트 파일 하나에 3분 이상 걸리고 60초 transport
 * timeout으로 실패했다. Node 24는 같은 모듈을 0.1초에 로드한다.
 *
 * 이 훅은 테스트 프로세스 안에서만 확장자를 보완한다. Worker 소스와 wrangler 빌드는
 * 전혀 바뀌지 않으므로 배포 산출물에 영향이 없다.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

// 확장자를 이미 가진 specifier는 건드리지 않는다(.js import 74건은 실제 .js 파일이다).
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;
const CANDIDATE_SUFFIXES = [".ts", ".js", "/index.ts", "/index.js"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    // cloudflare:workers는 배포 runtime의 가상 모듈이라 Node 기본 loader가 평가할 수 없다.
    // 이 resolver를 import한 테스트 프로세스에서만 최소 entrypoint 대역으로 바꾼다.
    if (specifier === "cloudflare:workers") {
      return {
        url: new URL("./cloudflareWorkersStub.mjs", import.meta.url).href,
        format: "module",
        shortCircuit: true,
      };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../"))
      && !HAS_EXTENSION.test(specifier)
      && context.parentURL
    ) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of CANDIDATE_SUFFIXES) {
        const candidate = new URL(base.href + suffix);
        if (existsSync(candidate)) {
          return { url: candidate.href, format: undefined, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
