import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");
const indexPath = resolve(distDir, "index.html");
const callbackPath = resolve(distDir, "oauth", "callback.html");

const indexHtml = await readFile(indexPath, "utf8");
// Vite의 base:"./"는 루트/Capacitor에 필요하지만 중첩된 물리 콜백 파일에서는
// ./assets가 /oauth/assets로 해석된다. HTML 자원 속성만 루트 절대 경로로 바꾼다.
const callbackHtml = indexHtml
  .replace("<head>", '<head>\n    <base href="/" />')
  .replaceAll('="./', '="/');

if (!callbackHtml.includes('src="/assets/index-')) {
  throw new Error("OAuth 콜백 엔트리에서 production 진입 번들을 찾지 못했습니다.");
}
await mkdir(dirname(callbackPath), { recursive: true });
await writeFile(callbackPath, callbackHtml, "utf8");
console.log("[OAuth callback] /oauth/callback 물리 엔트리 생성 (통과)");
