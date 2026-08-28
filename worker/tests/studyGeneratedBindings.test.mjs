import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const generated = readFileSync(new URL("../worker-configuration.d.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

function generatedStudyBindingNames(source) {
  const interfaceMarker = "interface __BaseEnv_Env {";
  const bodyStart = source.indexOf(interfaceMarker);
  if (bodyStart < 0) throw new Error("generated __BaseEnv_Env을 찾을 수 없습니다.");

  const bindings = [];
  let blockDepth = 0;
  let parenthesesDepth = 0;
  let bracketsDepth = 0;
  let atLineStart = true;
  let state = "code";
  let stringQuote = null;
  let closed = false;

  for (let index = bodyStart + interfaceMarker.length; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
        atLineStart = true;
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && nextCharacter === "/") {
        state = "code";
        index += 1;
      } else if (character === "\n") {
        atLineStart = true;
      }
      continue;
    }

    if (state === "string") {
      if (character === "\\") {
        index += 1;
      } else if (character === stringQuote) {
        state = "code";
        stringQuote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      state = "string";
      stringQuote = character;
      atLineStart = false;
      continue;
    }
    if (character === "\n") {
      atLineStart = true;
      continue;
    }
    if (atLineStart && (character === " " || character === "\t" || character === "\r")) continue;

    if (atLineStart && blockDepth === 0 && parenthesesDepth === 0 && bracketsDepth === 0) {
      const property = source.slice(index).match(/^(?:readonly[ \t\r]+)?(STUDY_[A-Z0-9_]+)[ \t\r]*\??[ \t\r]*:/);
      if (property) bindings.push(property[1]);
    }
    atLineStart = false;

    if (character === "{") blockDepth += 1;
    else if (character === "}") {
      if (blockDepth === 0) {
        closed = true;
        break;
      }
      blockDepth -= 1;
    } else if (character === "(") parenthesesDepth += 1;
    else if (character === ")") parenthesesDepth -= 1;
    else if (character === "[") bracketsDepth += 1;
    else if (character === "]") bracketsDepth -= 1;
  }

  if (!closed) throw new Error("generated __BaseEnv_Env의 끝을 찾을 수 없습니다.");
  return bindings;
}

test("Calendar Wrangler 생성 타입은 named Study service만 generic Service로 기록한다", () => {
  assert.match(wrangler, /\[\[services\]\][\s\S]*binding = "STUDY_SERVICE"[\s\S]*service = "hyeni-study"[\s\S]*entrypoint = "CalendarStudyService"/);
  assert.match(generated, /^\s*STUDY_SERVICE: Service \/\* entrypoint CalendarStudyService from hyeni-study \*\/;$/m);
  assert.doesNotMatch(generated, /\bCalendarStudyServiceBinding\b/);
  assert.doesNotMatch(generated, /\bSTUDY_[A-Z0-9_]*SECRET\b/);
});

test("generated Env는 STUDY_SERVICE 외 Study binding을 허용하지 않는다", () => {
  assert.deepEqual(generatedStudyBindingNames(generated), ["STUDY_SERVICE"]);

  for (const binding of ["STUDY_DB", "STUDY_JWT", "STUDY_ACCOUNT_DEVICE_SESSIONS"]) {
    const probe = generated.replace("\tSTUDY_SERVICE:", `\t${binding}: D1Database;\n\tSTUDY_SERVICE:`);
    assert.throws(() => assert.deepEqual(generatedStudyBindingNames(probe), ["STUDY_SERVICE"]));
  }
});

test("generated Env allowlist parser는 주석과 속성 타입 안의 STUDY 텍스트를 무시한다", () => {
  const commentAndTypeProbe = generated.replace(
    "\tSTUDY_SERVICE:",
    `\t/*
\tSTUDY_BLOCK_COMMENT: D1Database;
\t*/
\t// STUDY_LINE_COMMENT: D1Database;
\tEXAMPLE: \`STUDY_STRING_TEXT: D1Database; /* comment-like text */
\tSTUDY_STRING_CONTINUATION: D1Database;\`;
\t/*
\tSTUDY_TYPE_COMMENT: D1Database;
\t*/
\tSTUDY_SERVICE:`,
  );

  assert.deepEqual(generatedStudyBindingNames(commentAndTypeProbe), ["STUDY_SERVICE"]);
});
