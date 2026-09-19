/** 구형 작업 폴더·지도 키/청크가 빠진 dist의 운영 Pages 배포를 차단한다. 키 값은 출력하지 않는다. */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function inspectPagesMapBundle(dist) {
  const names = readdirSync(resolve(dist, "assets"));
  const scripts = names.filter(name => name.endsWith(".js"));
  const text = scripts.map(name => readFileSync(resolve(dist, "assets", name), "utf8")).join("\n");
  const html = readFileSync(resolve(dist, "index.html"), "utf8");
  const headers = readFileSync(resolve(dist, "_headers"), "utf8");
  const failures = [];
  for (const chunk of ["FamilyMap-", "GoogleMapAdapter-", "GoogleNativeMapAdapter-"]) {
    if (!scripts.some(name => name.startsWith(chunk))) failures.push(`${chunk} 지도 청크 누락`);
  }
  const entry = html.match(/src="(?:\.\/|\/)?assets\/([^"/]+\.js)"/)?.[1];
  if (!entry || !scripts.includes(entry)) failures.push("HTML 진입 청크 누락");
  if (!/AIza[A-Za-z0-9_-]{35}/.test(text)) failures.push("Google 공개 웹 지도 키 누락");
  for (const endpoint of ["/api/maps/search", "/api/maps/reverse", "/api/maps/directions"]) {
    if (!text.includes(endpoint)) failures.push(`${endpoint} 클라이언트 누락`);
  }
  for (const host of ["maps.googleapis.com", "maps.gstatic.com", "fonts.googleapis.com"]) {
    if (!headers.includes(`https://${host}`)) failures.push(`${host} CSP 허용 누락`);
  }
  if (failures.length) throw new Error(failures.join("; "));
  return { status: "PASS", entry, maps: "웹·Android·검색·주소·경로 클라이언트 포함", keyValueLogged: false };
}

export function assertPagesSourceCurrent(root) {
  const git = (...args) => execFileSync("git", args, {cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const remote = git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0];
  if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error("원격 main 정본을 확인할 수 없습니다.");
  try { git("merge-base", "--is-ancestor", remote, "HEAD"); }
  catch { throw new Error("최신 원격 main이 포함되지 않은 작업 폴더입니다. fetch 후 최신 소스에 수정을 합쳐 다시 빌드하세요."); }
  return remote;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const option = process.argv.indexOf("--app-root");
  const root = option < 0 ? resolve(import.meta.dirname,"..") : resolve(process.argv[option+1]);
  try {
    const upstream = assertPagesSourceCurrent(root);
    console.log(JSON.stringify({...inspectPagesMapBundle(resolve(root,"dist")), upstream},null,2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Pages 지도 배포 검사 실패");
    process.exitCode=1;
  }
}
