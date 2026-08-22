import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageFile = fileURLToPath(
  new URL("../ios/App/CapApp-SPM/Package.swift", import.meta.url),
);
const source = readFileSync(packageFile, "utf8");
const normalized = source.replace(
  /(path:\s*")([^"]+)(")/g,
  (_, prefix, packagePath, suffix) => `${prefix}${packagePath.replaceAll("\\", "/")}${suffix}`,
);

if (/path:\s*"[^"]*\\/.test(normalized)) {
  throw new Error("iOS Swift Package 경로에 Windows 역슬래시가 남아 있습니다.");
}
if (!normalized.includes('../../../node_modules/@capacitor/app')) {
  throw new Error("CapacitorApp iOS Swift Package 경로를 찾지 못했습니다.");
}
if (!normalized.includes('../../../node_modules/@capacitor/browser')) {
  throw new Error("CapacitorBrowser iOS Swift Package 경로를 찾지 못했습니다.");
}
if (normalized !== source) writeFileSync(packageFile, normalized, "utf8");

console.log("iOS Swift Package 경로 정규화 완료");
