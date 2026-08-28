import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const generated = readFileSync(new URL("../worker-configuration.d.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

function generatedStudyBindingNames(source) {
  const fileName = "worker-configuration.d.ts";
  const options = { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (requestedFileName, languageVersion) => (
    requestedFileName === fileName
      ? ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS)
      : undefined
  );
  host.fileExists = (requestedFileName) => requestedFileName === fileName;
  host.readFile = (requestedFileName) => (requestedFileName === fileName ? source : undefined);

  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) throw new Error("generated source file을 찾을 수 없습니다.");
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`generated source parse diagnostic: ${sourceFile.parseDiagnostics.map((diagnostic) => `TS${diagnostic.code}`).join(", ")}`);
  }

  const checker = program.getTypeChecker();
  const symbols = checker.getSymbolsInScope(sourceFile, ts.SymbolFlags.Type).filter(
    (symbol) => symbol.getName() === "__BaseEnv_Env",
  );
  if (symbols.length !== 1) throw new Error("generated __BaseEnv_Env 전역 symbol은 정확히 하나여야 합니다.");

  const envSymbol = symbols[0];
  const declarations = envSymbol.getDeclarations() ?? [];
  if (declarations.length !== 1 || !ts.isInterfaceDeclaration(declarations[0])) {
    throw new Error("generated __BaseEnv_Env은 merge 없는 단일 InterfaceDeclaration이어야 합니다.");
  }
  for (const clause of declarations[0].heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword || clause.types.some((type) => !checker.getSymbolAtLocation(type.expression))) {
      throw new Error("generated __BaseEnv_Env에 지원하지 않는 heritage가 있습니다.");
    }
  }

  return checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(envSymbol)).flatMap((property) => {
    const propertyDeclarations = property.getDeclarations() ?? [];
    if (propertyDeclarations.length === 0 || propertyDeclarations.some((declaration) => (
      !ts.isPropertySignature(declaration)
      || !declaration.name
      || (!ts.isIdentifier(declaration.name) && !ts.isStringLiteral(declaration.name))
    ))) {
      throw new Error("generated __BaseEnv_Env에 지원하지 않는 effective property가 있습니다.");
    }
    return property.getName().startsWith("STUDY_") ? [property.getName()] : [];
  });
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
\tEXAMPLE: {
\t\tnested: { STUDY_NESTED: D1Database };
\t\tsingle: 'STUDY_SINGLE_TEXT: D1Database;';
\t\tdouble: "STUDY_DOUBLE_TEXT: D1Database;";
\t\tescaped: "STUDY_ESCAPED_TEXT: D1Database; \\" escaped";
\t\ttemplate: \`STUDY_STRING_TEXT: D1Database; /* comment-like text */
\t\tSTUDY_STRING_CONTINUATION: D1Database;\`;
\t\t/*
\t\tSTUDY_TYPE_COMMENT: D1Database;
\t\t*/
\t};
\tSTUDY_SERVICE:`,
  );

  assert.deepEqual(generatedStudyBindingNames(commentAndTypeProbe), ["STUDY_SERVICE"]);
});

test("generated Env allowlist parser는 가짜 interface marker와 같은 줄 property를 구분한다", () => {
  const decoyProbe = [
    "/* interface __BaseEnv_Env { STUDY_BLOCK: D1Database; } */",
    "// interface __BaseEnv_Env { STUDY_LINE: D1Database; }",
    "const single = 'interface __BaseEnv_Env { STUDY_SINGLE: D1Database; }';",
    'const double = "interface __BaseEnv_Env { STUDY_DOUBLE: D1Database; }";',
    "const template = `interface __BaseEnv_Env { STUDY_TEMPLATE: D1Database; }`;",
    generated,
  ].join("\n");
  const sameLineProbe = generated.replace(
    /^\tSTUDY_SERVICE:.*$/m,
    "\tSTUDY_SERVICE: Service; STUDY_DB: D1Database;",
  );
  const stringNameProbe = generated.replace(
    /^\tSTUDY_SERVICE:.*$/m,
    '\t"STUDY_SERVICE": Service;',
  );

  assert.deepEqual(generatedStudyBindingNames(decoyProbe), ["STUDY_SERVICE"]);
  assert.deepEqual(generatedStudyBindingNames(sameLineProbe), ["STUDY_SERVICE", "STUDY_DB"]);
  assert.deepEqual(generatedStudyBindingNames(stringNameProbe), ["STUDY_SERVICE"]);
});

test("generated Env allowlist parser는 interface 부재·중복·computed property를 fail-closed한다", () => {
  const duplicateInterfaceProbe = `${generated}\ninterface __BaseEnv_Env {\n\tSTUDY_DB: D1Database;\n}`;
  const computedNameProbe = generated.replace(
    /^\tSTUDY_SERVICE:.*$/m,
    '\t["STUDY_COMPUTED"]: D1Database;\n\tSTUDY_SERVICE: Service;',
  );

  assert.throws(() => generatedStudyBindingNames("interface DifferentEnv {}"));
  assert.throws(() => generatedStudyBindingNames(duplicateInterfaceProbe));
  assert.throws(() => generatedStudyBindingNames(computedNameProbe));
});

test("generated Env allowlist parser는 TypeScript parse diagnostic을 fail-closed한다", () => {
  const incompleteExpressionProbe = `${generated}\nconst incomplete = ;`;
  const unterminatedTemplateProbe = `${generated}\nconst unterminated = ${"`"}`;

  assert.throws(() => generatedStudyBindingNames(incompleteExpressionProbe), /TS1109/);
  assert.throws(() => generatedStudyBindingNames(unterminatedTemplateProbe), /TS1160/);
});

test("generated Env allowlist parser는 상속 바인딩을 검사하고 class·namespace merge를 fail-closed한다", () => {
  const inheritedBindingProbe = [
    "interface HiddenStudyBindings { STUDY_DB: D1Database; }",
    generated.replace("interface __BaseEnv_Env {", "interface __BaseEnv_Env extends HiddenStudyBindings {"),
  ].join("\n");
  const classMergeProbe = `${generated}\ndeclare class __BaseEnv_Env { STUDY_DB: D1Database; }`;
  const namespaceMergeProbe = `${generated}\ndeclare namespace __BaseEnv_Env { const STUDY_DB: D1Database; }`;

  assert.deepEqual(generatedStudyBindingNames(inheritedBindingProbe).sort(), ["STUDY_DB", "STUDY_SERVICE"]);
  assert.throws(() => generatedStudyBindingNames(classMergeProbe));
  assert.throws(() => generatedStudyBindingNames(namespaceMergeProbe));
});
