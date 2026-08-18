#!/usr/bin/env python3
"""Regenerate data.js from catalog.json + walls.json (run after a price-guide update)."""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent
catalog = json.loads((root / "catalog.json").read_text())
walls = json.loads((root / "walls.json").read_text())

out = "// Generated from catalog.json + walls.json (Sprout Studio price guide, fetched %s)\n" % catalog.get("fetched", "")
out += "// To update: edit catalog.json, re-run tools/embed_data.py\n"
out += "const CATALOG = " + json.dumps(catalog["products"], indent=1) + ";\n\n"
out += "const WALLS = " + json.dumps(walls, indent=1) + ";\n"
(root / "data.js").write_text(out)
print("data.js written,", len(out), "bytes")
