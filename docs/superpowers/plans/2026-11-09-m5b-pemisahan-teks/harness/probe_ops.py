"""Counts Tc / Tw / Tz operators and TJ/Tj/Td in each reference's page content streams. python probe_ops.py [REFS]"""
import re, sys, collections, pymupdf
from pathlib import Path

import paths  # noqa: E402 - harness/paths.py: default OUT, REFS, REPO
for f in sorted((Path(sys.argv[1]) if len(sys.argv) > 1 else paths.REFS).glob("*.pdf")):
    doc = pymupdf.open(f)
    c = collections.Counter()
    for page in doc:
        s = page.read_contents().decode("latin-1")
        for m in re.finditer(r"(-?[\d.]+)\s+(Tc|Tw|Tz)\b", s):
            v = float(m.group(1))
            c[(m.group(2), round(v, 3))] += 1
        c["TJ"] += len(re.findall(r"\]\s*TJ", s)); c["Tj"] += len(re.findall(r"\)\s*Tj|>\s*Tj", s))
        c["Td/Tm"] += len(re.findall(r"\b(Td|TD|Tm)\b", s))
    print(f.name, dict(sorted(c.items(), key=lambda kv: -kv[1])[:14]))
