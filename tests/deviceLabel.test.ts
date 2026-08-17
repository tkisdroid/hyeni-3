import test from "node:test";
import assert from "node:assert/strict";

import { resolveDeviceLabel } from "../src/transform/deviceLabel.ts";

test("최신 네이티브 상태의 실제 모델명을 오래된 기기 라벨보다 우선한다", () => {
  assert.equal(resolveDeviceLabel({
    deviceLabel: "sdk_gphone64_x86_64",
    manufacturer: "motorola",
    model: "motorola razr 40 ultra",
  }), "motorola razr 40 ultra");
});

test("삼성 모델명은 기존 기기 라벨과 같은 읽기 쉬운 형식으로 표시한다", () => {
  assert.equal(resolveDeviceLabel({
    deviceLabel: "이전 기기",
    manufacturer: "samsung",
    model: "SM-A175N",
  }), "삼성 SM-A175N");
});

test("네이티브 모델이 없으면 기존 기기 라벨을 공백 정리해 유지한다", () => {
  assert.equal(resolveDeviceLabel({
    deviceLabel: "  motorola razr 40 ultra  ",
    manufacturer: null,
    model: null,
  }), "motorola razr 40 ultra");
});

test("사용할 수 있는 보고값이 없으면 미확인 상태를 유지한다", () => {
  assert.equal(resolveDeviceLabel({
    deviceLabel: "  ",
    manufacturer: " ",
    model: " ",
  }), null);
});
