import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("가족 WebSocket은 access JWT 대신 짧은 1회용 ticket만 URL에 넣는다", () => {
  const socket = source("src/realtime/familySocket.ts");
  const endpoint = source("src/lib/api/endpoints/realtime.ts");
  const queryHook = source("src/queries/useFamilyRealtime.ts");
  const remoteAudio = source("src/screens/feature/RemoteAudio.tsx");

  assert.match(socket, /createFamilyRealtimeTicket\(familyId, signal\)/);
  assert.match(socket, /[?&]ticket=\$\{encodeURIComponent\(ticket\)\}/);
  assert.doesNotMatch(socket, /[?&]token=|getApiAccessToken|Bearer\s/);
  assert.match(endpoint, /apiPost<unknown>\(\s*"\/api\/realtime\/ticket"/);
  assert.match(endpoint, /ticket\.split\("\."\)\.length !== 3/);
  assert.match(endpoint, /Number\.isSafeInteger\(expiresInSeconds\)/);
  assert.match(endpoint, /Number\(expiresInSeconds\) > 45/);
  assert.doesNotMatch(endpoint, /Date\.now\(\)/);
  assert.doesNotMatch(queryHook, /getApiAccessToken/);
  assert.doesNotMatch(remoteAudio, /getApiAccessToken/);
});

test("재연결도 매번 새 ticket을 발급하고 중복 연결 시도를 직렬화한다", () => {
  const socket = source("src/realtime/familySocket.ts");

  assert.match(socket, /async function connect\(\): Promise<void>/);
  assert.match(socket, /if \(disposed \|\| connecting\) return/);
  assert.match(socket, /connecting = true/);
  assert.match(socket, /createBoundedRealtimeTicketRequest/);
  assert.match(socket, /activeTicketRequest\?\.abort\(\)/);
  assert.match(socket, /finally \{[\s\S]*?connecting = false;\s*\}/);
  assert.match(socket, /reconnectTimer = setTimeout\(\(\) => \{[\s\S]*?void connect\(\)/);
});
