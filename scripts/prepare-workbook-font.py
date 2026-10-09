"""Rebuild the static HK Regular font data module from the pinned official VF.

Requires fontTools 4.61.1. The input SHA-256 is checked before instantiation.
Usage: python scripts/prepare-workbook-font.py path/to/NotoSansHK-VF.ttf
Source: Noto CJK Sans2.004 / Sans/Variable/TTF/Subset/NotoSansHK-VF.ttf
No runtime font conversion and no network use in this helper.
"""
import base64
import hashlib
from pathlib import Path
import sys
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

if fontTools.__version__ != "4.61.1":
    raise RuntimeError("Use fontTools 4.61.1 for reproducible font instantiation")
source = Path(sys.argv[1])
if hashlib.sha256(source.read_bytes()).hexdigest() != "70172afd2cf0e045182787219b949e7798253982a36e364114757c09efd55477":
    raise RuntimeError("The font input does not match the pinned official font")
font = TTFont(source)
instantiateVariableFont(font, {"wght": 400}, inplace=True, updateFontNames=True)
assert "fvar" not in font and "glyf" in font
from io import BytesIO
font.recalcTimestamp = False
output = BytesIO()
font.save(output)
payload = output.getvalue()
target = Path(__file__).resolve().parent.parent / "src/vendor/noto-sans-hk-regular.js"
target.write_text(
    "// Noto Sans HK Regular static TTF, weight 400 instantiated from Noto CJK Sans2.004.\n"
    "// OFL-1.1; see NotoSansHK-LICENSE.txt and README.txt.\n"
    'export const fontBase64 = "' + base64.b64encode(payload).decode("ascii") + '";\n',
    encoding="utf-8", newline="\n"
)
print(f"Static TTF SHA-256: {hashlib.sha256(payload).hexdigest()}")
