#!/usr/bin/env python3
"""PostgreSQL(Supabase) schema.sql -> SQLite CREATE TABLE 변환.

- public 스키마 CREATE TABLE 만 추출
- 타입 매핑 (uuid/text/jsonb/date/timestamp/time/array -> TEXT, bool/int/bigint -> INTEGER, double/numeric -> REAL)
- ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY 를 CREATE TABLE 안으로 인라인
- CHECK / FK / 트리거 / 함수 / RLS / 확장 / 시퀀스 / COMMENT 모두 제외
- "public". 접두사 제거
"""
import re
import sys

SCHEMA_PATH = sys.argv[1]
OUT_PATH = sys.argv[2]

with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
    sql = f.read()

# ---------------------------------------------------------------------------
# 1) ALTER TABLE PRIMARY KEY 수집  ->  {table: [col, ...]}
# ---------------------------------------------------------------------------
pk_map = {}
pk_re = re.compile(
    r'ALTER TABLE (?:ONLY )?"public"\."([a-z_]+)"\s*\n\s*'
    r'ADD CONSTRAINT "[^"]+" PRIMARY KEY \(([^)]+)\)',
    re.MULTILINE,
)
for m in pk_re.finditer(sql):
    table = m.group(1)
    cols = re.findall(r'"([^"]+)"', m.group(2))
    pk_map[table] = cols

# ---------------------------------------------------------------------------
# 2) CREATE TABLE 블록 추출
# ---------------------------------------------------------------------------
create_re = re.compile(
    r'CREATE TABLE IF NOT EXISTS "public"\."([a-z_]+)" \(\n(.*?)\n\);',
    re.DOTALL,
)


def map_type(raw: str) -> str:
    t = raw.strip().lower()
    if "[]" in t:               # 모든 배열 -> JSON 문자열
        return "TEXT"
    if "bool" in t:
        return "INTEGER"
    if any(k in t for k in ("bigint", "integer", "smallint", "serial")):
        return "INTEGER"
    if any(k in t for k in ("double", "real", "numeric", "decimal", "float")):
        return "REAL"
    # uuid/text/jsonb/json/date/timestamp/time/char/varchar/interval 등
    return "TEXT"


def convert_default(expr: str) -> str | None:
    """PG DEFAULT 표현 -> SQLite. None 이면 DEFAULT 절 통째로 제거."""
    e = expr.strip()
    low = e.lower()
    norm = low.replace('"', "").replace(" ", "")
    # now() 기반 표현(중첩 괄호/AT TIME ZONE/interval 포함) -> CURRENT_TIMESTAMP
    if "now()" in norm:
        return "CURRENT_TIMESTAMP"
    if "gen_random_uuid" in low or "uuid_generate" in low or low.startswith("nextval"):
        return None
    if low == "false":
        return "0"
    if low == "true":
        return "1"
    # '값'::"type"  /  '값'::type without time zone  -> '값'
    e = re.sub(r"::\"?[a-zA-Z_ ]+\"?(\[\])?", "", e)
    e = re.sub(r"\bARRAY\[\]", "'[]'", e)
    return e.strip()


def split_columns(body: str):
    """CREATE TABLE 본문을 최상위 콤마 기준으로 분리.

    괄호 깊이 + 작은따옴표 문자열 리터럴('' 이스케이프 포함)을 인식해
    문자열 내부 콤마('{15,5}' 등)로 잘못 쪼개지지 않게 한다.
    """
    parts, depth, cur, in_str = [], 0, "", False
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if ch == "'":
            if in_str and i + 1 < n and body[i + 1] == "'":  # '' 이스케이프
                cur += "''"
                i += 2
                continue
            in_str = not in_str
            cur += ch
        elif not in_str and ch == "(":
            depth += 1
            cur += ch
        elif not in_str and ch == ")":
            depth -= 1
            cur += ch
        elif not in_str and ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    if cur.strip():
        parts.append(cur)
    return parts


col_re = re.compile(r'^\s*"([^"]+)"\s+(.*)$', re.DOTALL)
out_tables = []

for m in create_re.finditer(sql):
    table = m.group(1)
    body = m.group(2)
    col_defs = []
    for part in split_columns(body):
        s = part.strip()
        if not s:
            continue
        # 제약 줄 제외 (CHECK / FK / UNIQUE / PRIMARY KEY 인라인 / CONSTRAINT)
        if re.match(r"^(CONSTRAINT|CHECK|FOREIGN|UNIQUE|PRIMARY)\b", s, re.IGNORECASE):
            continue
        cm = col_re.match(s)
        if not cm:
            continue
        col = cm.group(1)
        rest = cm.group(2).strip()

        not_null = bool(re.search(r"\bNOT NULL\b", rest, re.IGNORECASE))

        default_val = None
        dm = re.search(r"\bDEFAULT\s+(.*?)(?:\s+NOT NULL)?$", rest, re.IGNORECASE | re.DOTALL)
        type_part = rest
        if dm:
            default_val = convert_default(dm.group(1))
            type_part = rest[: dm.start()].strip()
        else:
            type_part = re.sub(r"\s*NOT NULL\s*$", "", rest, flags=re.IGNORECASE).strip()

        sqlite_type = map_type(type_part)

        line = f'  "{col}" {sqlite_type}'
        if default_val is not None and default_val != "":
            line += f" DEFAULT {default_val}"
        if not_null:
            line += " NOT NULL"
        col_defs.append(line)

    # PRIMARY KEY 인라인 (테이블 제약)
    if table in pk_map:
        pk_cols = ", ".join(f'"{c}"' for c in pk_map[table])
        col_defs.append(f"  PRIMARY KEY ({pk_cols})")

    ddl = f'CREATE TABLE "{table}" (\n' + ",\n".join(col_defs) + "\n);"
    out_tables.append((table, ddl))

# ---------------------------------------------------------------------------
# 3) 출력
# ---------------------------------------------------------------------------
header = (
    "-- 혜니캘린더 D1(SQLite) 스키마 — PostgreSQL 덤프에서 자동 변환\n"
    "-- 함수/RLS/트리거/FK/확장은 제외됨 (앱 백엔드 재구현 시 별도 처리)\n"
    "PRAGMA foreign_keys = OFF;\n\n"
)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write(header)
    for table, ddl in out_tables:
        f.write(ddl + "\n\n")

print(f"변환 테이블 수: {len(out_tables)}")
print(f"PK 인라인된 테이블 수: {sum(1 for t, _ in out_tables if t in pk_map)}")
print(f"PK 없는 테이블: {[t for t, _ in out_tables if t not in pk_map]}")
print(f"출력: {OUT_PATH}")
