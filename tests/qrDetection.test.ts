import test from "node:test";
import assert from "node:assert/strict";

import { decidePairingQrDetection } from "../src/transform/pairCode.ts";

test("유효한 아이 페어링 QR만 제출 대상으로 확정한다", () => {
  assert.deepEqual(decidePairingQrDetection("KID-ab12cd34"), {
    accepted: true,
    code: "KID-AB12CD34",
  });
  assert.deepEqual(decidePairingQrDetection("https://example.com/?code=KID-xy12zz34"), {
    accepted: true,
    code: "KID-XY12ZZ34",
  });
});

test("주변의 다른 QR이나 빈 값은 창을 닫지 않고 재스캔한다", () => {
  assert.deepEqual(decidePairingQrDetection("https://example.com/menu"), {
    accepted: false,
    code: null,
  });
  assert.deepEqual(decidePairingQrDetection(""), {
    accepted: false,
    code: null,
  });
});
