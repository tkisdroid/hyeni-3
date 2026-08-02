// D1(SQLite) 저장 형태 → Supabase(PostgREST/RPC) 응답 형태 역직렬화 헬퍼.
// 데이터 이관 시 PostgreSQL 타입이 다음과 같이 D1에 저장됐다:
//   · jsonb         → TEXT(JSON 문자열)        예: '{"lat":37.3,...}'
//   · boolean       → INTEGER 0/1
//   · uuid[]/text[] → TEXT(PG array literal)    예: '{}' / '{uuid1,uuid2}'
// 클라(sync.js rowTo*)는 Supabase 응답 형태(객체/boolean/JS배열)를 기대하므로
// Worker 라우트가 응답 직전에 이 헬퍼로 형태를 되돌린다.

// jsonb TEXT → 객체. 이미 객체거나 null이면 그대로. 파싱 실패 시 원본 유지(방어).
export function parseJson(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

// SQLite INTEGER 0/1 → boolean. (PostgREST는 boolean을 true/false로 반환)
export function toBool(v: unknown): boolean {
  return !!v && v !== "0";
}

// PostgreSQL array literal TEXT → JS 배열.
//   '{}'              → []
//   '{a,b,c}'         → ['a','b','c']
//   '{"x,y",z}'       → ['x,y','z']  (따옴표로 감싼 요소 내 콤마 보존)
// uuid[] 는 따옴표 없이 콤마 구분되지만, 인용 요소도 안전하게 처리한다.
export function pgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== "string") return [];
  const s = v.trim();
  if (!s || s === "{}") return [];
  if (!(s.startsWith("{") && s.endsWith("}"))) return [];
  const inner = s.slice(1, -1);
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') {
      // 이스케이프된 따옴표("") 처리
      if (inQuotes && inner[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

// JS 배열 → PostgreSQL array literal TEXT (read_by uuid[] 쓰기용).
//   [] → '{}', ['a','b'] → '{a,b}'. uuid 는 콤마/특수문자가 없어 인용 불필요.
export function toPgArray(arr: string[]): string {
  if (!arr || arr.length === 0) return "{}";
  return "{" + arr.join(",") + "}";
}
