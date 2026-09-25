// 웹 기기 상태의 네트워크 종류 — effectiveType("4g")은 속도 등급이라 Wi-Fi·유선에서도 "4G"로 잘못 표시됐다
// (2026-09-25 브라우저 QA). 실제 연결 종류(connection.type)만 보고한다.
import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { readNetwork } = await import("../src/lib/native/deviceStatus.ts");

test("connection.type 이 실제 종류일 때만 보고하고 effectiveType 은 쓰지 않는다", () => {
  assert.deepEqual(readNetwork({ onLine: true, connection: { type: "wifi" } }), { networkConnected: true, networkType: "wifi" });
  assert.deepEqual(readNetwork({ onLine: true, connection: { type: "cellular" } }), { networkConnected: true, networkType: "cellular" });
  assert.deepEqual(
    readNetwork({ onLine: true, connection: { effectiveType: "4g" } as { type?: string } }),
    { networkConnected: true, networkType: null },
  );
  assert.deepEqual(readNetwork({ onLine: true, connection: { type: "unknown" } }), { networkConnected: true, networkType: null });
  assert.deepEqual(readNetwork({ onLine: false }), { networkConnected: false, networkType: null });
});
