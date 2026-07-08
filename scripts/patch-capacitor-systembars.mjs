import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetPath = resolve(
  "node_modules",
  "@capacitor",
  "android",
  "capacitor",
  "src",
  "main",
  "java",
  "com",
  "getcapacitor",
  "plugin",
  "SystemBars.java",
);

if (!existsSync(targetPath)) {
  console.warn("[patch-capacitor-systembars] @capacitor/android SystemBars.java not found; skipping.");
  process.exit(0);
}

const source = readFileSync(targetPath, "utf8");

if (source.includes("if (document.documentElement) {")) {
  console.log("[patch-capacitor-systembars] already patched.");
  process.exit(0);
}

const before = `                    try {
                      document.documentElement.style.setProperty("--safe-area-inset-top", "%dpx");
                      document.documentElement.style.setProperty("--safe-area-inset-right", "%dpx");
                      document.documentElement.style.setProperty("--safe-area-inset-bottom", "%dpx");
                      document.documentElement.style.setProperty("--safe-area-inset-left", "%dpx");
                    } catch(e) { console.error('Error injecting safe area CSS:', e); }`;

const after = `                    try {
                      if (document.documentElement) {
                        document.documentElement.style.setProperty("--safe-area-inset-top", "%dpx");
                        document.documentElement.style.setProperty("--safe-area-inset-right", "%dpx");
                        document.documentElement.style.setProperty("--safe-area-inset-bottom", "%dpx");
                        document.documentElement.style.setProperty("--safe-area-inset-left", "%dpx");
                      }
                    } catch(e) { console.error('Error injecting safe area CSS:', e); }`;

if (!source.includes(before)) {
  throw new Error("[patch-capacitor-systembars] expected SystemBars.java safe area block was not found.");
}

writeFileSync(targetPath, source.replace(before, after));
console.log("[patch-capacitor-systembars] patched SystemBars.java safe area injection guard.");
