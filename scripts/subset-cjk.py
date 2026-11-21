# One-off: cut src/fonts/notosanssc-gb2312-400-normal.ttf from the Google Fonts Noto Sans SC variable TTF (OFL-1.1).
# Usage: python -I scripts/subset-cjk.py NotoSansSC[wght].ttf   (needs fonttools; not part of the build)
# Kept: Latin basics, GB2312 level 1+2 hanzi, CJK + full-width punctuation/forms. The font declares Reserved Font Name 'Source',
# which we do not use: the family is renamed "MossPDF Sans SC" (name records mentioning Source are rewritten).
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

src, out = sys.argv[1], "src/fonts/notosanssc-gb2312-400-normal.ttf"
cps = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0xFF00, 0xFFF0))
for hi in range(0xA1, 0xF8):
    for lo in range(0xA1, 0xFF):
        try: cps.add(ord(bytes([hi, lo]).decode("gb2312")))
        except UnicodeDecodeError: pass
f = instantiateVariableFont(TTFont(src), {"wght": 400})
opt = subset.Options(); opt.layout_features = []; opt.notdef_outline = True; opt.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]; opt.hinting = False; opt.desubroutinize = True
s = subset.Subsetter(opt); s.populate(unicodes=cps); s.subset(f)
for n in f["name"].names:
    t = n.toUnicode()
    if n.nameID in (1, 4): t = "MossPDF Sans SC" + (" Regular" if n.nameID == 4 else "")
    if n.nameID == 6: t = "MossPDFSansSC-Regular"
    if n.nameID == 3: t = "MossPDF Sans SC Regular subset"
    n.string = t
f["name"].names = [n for n in f["name"].names if n.nameID < 256]
for t in ("vhea", "vmtx", "STAT", "BASE", "GDEF", "GPOS", "GSUB", "gasp"):
    if t in f: del f[t]
f.save(out)
print(out, len(f.getGlyphOrder()), "glyphs")
