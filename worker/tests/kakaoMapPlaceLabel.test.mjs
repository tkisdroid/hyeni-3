import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const { createKakaoMapAdapter } = await import("../lib/maps/kakao.ts");

async function reverseWith({ building = "", documents = [], failure = false, more = false }, check) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.includes("coord2address")) {
      return Response.json({ documents: [{ road_address: { address_name: "서울 가상길 10", building_name: building }, address: { address_name: "서울 가상동 100" } }] });
    }
    if (failure) throw new Error("지도 일시 장애");
    return Response.json({ documents, meta: { is_end: !more } });
  };
  try {
    const label = await createKakaoMapAdapter({ KAKAO_REST_KEY: "test-key" }).reverse({ lat: 37.5, lng: 127 }, "ko");
    await check(label, calls);
  } finally { globalThis.fetch = originalFetch; }
}

const store = { id: "shop", place_name: "가상도서관", road_address_name: "서울 가상길 10", x: "127.0001", y: "37.5" };

test("지도 건물명이 있으면 긴 주소 대신 건물명만 표시하며 상호 검색을 생략한다", async () => {
  await reverseWith({ building: "가상문화센터" }, (label, calls) => {
    assert.equal(label, "가상문화센터");
    assert.equal(calls.length, 1);
  });
});

test("건물명이 없고 같은 주소의 가까운 상호가 하나이면 그 상호를 표시한다", async () => {
  await reverseWith({ documents: [store, { ...store }] }, (label, calls) => {
    assert.equal(label, "가상도서관");
    assert.equal(calls[1].searchParams.get("radius"), "35");
    assert.equal(calls[1].searchParams.get("query"), "서울 가상길 10");
  });
});

test("옆 건물·먼 상호·복수 입점·불완전 검색·장애는 상호를 추정하지 않고 주소를 유지한다", async () => {
  const cases = [
    { documents: [{ ...store, road_address_name: "서울 가상길 12" }] },
    { documents: [{ ...store, x: "127.005" }] },
    { documents: [store, { ...store, id: "second", place_name: "같은 건물 다른 가게" }] },
    { documents: [store], more: true },
    { failure: true },
    {},
  ];
  for (const scenario of cases) await reverseWith(scenario, label => assert.equal(label, "가상동 100"));
});
