# One-off: cut the optional CJK fonts in src/fonts/ from the Google Fonts Noto Sans SC/TC/JP/KR variable TTFs (OFL-1.1, github.com/google/fonts/ofl).
# Usage: python -I scripts/subset-cjk.py sc|tc|jp|kr NotoSansXX[wght].ttf   (needs fonttools; not part of the build)
# Kept: Latin basics, general + CJK punctuation, full-width forms, and per language: SC GB2312 hanzi; TC Big5 level 1 (the ~5,400 common hanzi) plus Big5 symbols;
# JP JIS X 0208 (kana, level 1-2 kanji); KR all 11,172 Hangul syllables + compatibility jamo.
# The fonts declare Reserved Font Name 'Source', which we do not use: each family is renamed "MossPDF Sans <XX>" (name records mentioning Source are rewritten).
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

def pairs(codec, his, los):
    for hi in his:
        for lo in los:
            try: yield ord(bytes([hi, lo]).decode(codec))
            except (UnicodeDecodeError, ValueError): pass

lang, src = sys.argv[1], sys.argv[2]
cps = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0xFF00, 0xFFF0))
if lang == "sc": cps |= set(pairs("gb2312", range(0xA1, 0xF8), range(0xA1, 0xFF))); file = "notosanssc-gb2312"
elif lang == "tc": cps |= set(pairs("big5", range(0xA1, 0xC7), list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)))); file = "notosanstc-big5"
elif lang == "jp": cps |= set(pairs("euc_jp", range(0xA1, 0xFF), range(0xA1, 0xFF))); file = "notosansjp-jisx0208"
elif lang == "kr": cps |= set(range(0xAC00, 0xD7A4)) | set(range(0x3131, 0x318F)); file = "notosanskr-hangul"
else: sys.exit("lang must be sc, tc, jp or kr")
out, fam = f"src/fonts/{file}-400-normal.ttf", "MossPDF Sans " + lang.upper()
f = instantiateVariableFont(TTFont(src), {"wght": 400})
opt = subset.Options(); opt.layout_features = []; opt.notdef_outline = True; opt.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]; opt.hinting = False; opt.desubroutinize = True
s = subset.Subsetter(opt); s.populate(unicodes=cps); s.subset(f)
for n in f["name"].names:
    t = n.toUnicode()
    if n.nameID in (1, 4): t = fam + (" Regular" if n.nameID == 4 else "")
    if n.nameID == 6: t = fam.replace(" ", "") + "-Regular"
    if n.nameID == 3: t = fam + " Regular subset"
    n.string = t
f["name"].names = [n for n in f["name"].names if n.nameID < 256]
for t in ("vhea", "vmtx", "STAT", "BASE", "GDEF", "GPOS", "GSUB", "gasp"):
    if t in f: del f[t]
f.save(out)
print(out, len(f.getGlyphOrder()), "glyphs")
