# Pretendard Variable 을 유니코드 구간 조각(woff2)으로 나눠 public/fonts/pretendard 와 src/styles/pretendard.css 를 만든다.
# 구간 기준 = Jua(Google Fonts 한글 빈도 분할)의 unicode-range. 거기 없는 글자는 추가 조각으로 모아 빠짐없이 덮는다.
# 실행: python3 -m venv .venv && .venv/bin/pip install fonttools brotli && .venv/bin/python scripts/fonts/slice-pretendard.py
import os, re, sys
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer
import io

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = f"{ROOT}/fonts/PretendardVariable.woff2"
OUT_DIR = f"{ROOT}/public/fonts/pretendard"
CSS_OUT = f"{ROOT}/src/styles/pretendard.css"
EXTRA_SIZE = 220

FAMILY = "Hyeni Sans"

def rename(tt, idx):
    """OFL 예약 글꼴 이름: 쪼갠(수정한) 글꼴은 원래 이름을 쓰지 않는다. 저작권(0)·라이선스(13·14)는 그대로 둔다."""
    name = tt["name"]
    for rec in list(name.names):
        if rec.nameID in (16, 17, 21, 22):
            name.removeNames(nameID=rec.nameID)
    for nid, value in ((1, FAMILY), (2, "Regular"), (3, f"HyeniSans-Slice-{idx}"), (4, FAMILY), (6, "HyeniSans")):
        name.setName(value, nid, 3, 1, 0x409)
        name.setName(value, nid, 1, 0, 0)

def parse_range(text):
    cps = set()
    for part in text.split(","):
        part = part.strip().upper().replace("U+", "")
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-")
            cps.update(range(int(a, 16), int(b, 16) + 1))
        else:
            cps.add(int(part, 16))
    return cps

def to_ranges(cps):
    out = []
    s = sorted(cps)
    start = prev = s[0]
    for c in s[1:]:
        if c == prev + 1:
            prev = c
            continue
        out.append((start, prev))
        start = prev = c
    out.append((start, prev))
    return ", ".join(f"U+{a:x}" if a == b else f"U+{a:x}-{b:x}" for a, b in out)

jua = open(f"{ROOT}/src/styles/jua.css", encoding="utf-8").read()
jua_ranges = [parse_range(m) for m in re.findall(r"unicode-range:([^;]+);", jua)]
# 가장 흔한 조각(라틴 기본·.119)이 먼저 글자를 가져가도록 뒤에서부터 배정한다.
order = list(reversed(jua_ranges))

# 앱이 쓰는 굵기(400 안내 문구 ~ 800 큰 숫자)만 남겨 조각을 약 30% 줄인다.
_lim = instancer.instantiateVariableFont(TTFont(SRC), {"wght": (400, 800)})
_buf = io.BytesIO(); _lim.save(_buf); LIMITED = _buf.getvalue()
font = TTFont(io.BytesIO(LIMITED))
cmap = set(font.getBestCmap().keys())
assigned = []
taken = set()
for rng in order:
    mine = (rng & cmap) - taken
    if mine:
        assigned.append(mine)
        taken |= mine
rest = sorted(cmap - taken)
for i in range(0, len(rest), EXTRA_SIZE):
    assigned.append(set(rest[i:i + EXTRA_SIZE]))

os.makedirs(OUT_DIR, exist_ok=True)
for f in os.listdir(OUT_DIR):
    if f.endswith(".woff2"):
        os.remove(os.path.join(OUT_DIR, f))

faces = []
total = 0
for idx, cps in enumerate(assigned):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    sub = TTFont(io.BytesIO(LIMITED))
    subsetter = subset.Subsetter(opts)
    subsetter.populate(unicodes=sorted(cps))
    subsetter.subset(sub)
    rename(sub, idx)
    name = f"pretendard.{idx}.woff2"
    path = os.path.join(OUT_DIR, name)
    sub.flavor = "woff2"
    sub.save(path)
    size = os.path.getsize(path)
    total += size
    faces.append(
        "@font-face{font-family:'Hyeni Sans';font-style:normal;font-weight:400 800;font-display:swap;"
        f"src:url('/fonts/pretendard/{name}') format('woff2');unicode-range:{to_ranges(cps)};}}"
    )

header = """/* Hyeni Sans = Pretendard Variable 1.309(SIL OFL 1.1, Copyright © 2023 Kil Hyung-jin)의 굵기 400–800 · 유니코드 구간 조각.
   OFL 예약 글꼴 이름 때문에 수정본(조각)은 다른 이름을 쓴다.
   2MB 단일 파일은 싣지 않는다: unicode-range 덕에 브라우저는 화면에 실제로 쓰인 글자 구간의 조각만 받는다.
   구간은 Jua 와 같은 한글 빈도 분할을 따르고, 거기 없는 글자는 추가 조각으로 덮는다. 재생성: scripts/fonts/slice-pretendard.py
   라이선스 전문: public/fonts/pretendard/OFL.txt */
"""
with open(CSS_OUT, "w", encoding="utf-8") as fh:
    fh.write(header + "\n".join(faces) + "\n")
print(f"slices={len(assigned)} total={total} bytes css={os.path.getsize(CSS_OUT)} covered={len(taken)+len(rest)}/{len(cmap)}")
sizes = sorted(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR) if f.endswith('.woff2'))
print("min", sizes[0], "median", sizes[len(sizes)//2], "max", sizes[-1])
