#!/usr/bin/env python3
"""Patch mcp-server-fetch to clean content BEFORE the 5000-char window.

Adds:
  1. Noise stripping (CMS artifacts, nav, images, CTAs)
  2. Comment section removal
  3. Markdown normalization (headers, bold, links -> prose)

The cleaning runs on the FULL page before start_index/max_length windowing,
so pagination indices stay accurate on the cleaned content.

Run after `uvx --from mcp-server-fetch python3 -c "pass"` to pre-warm the cache.
"""
import sys, os, glob

# Find all cached server.py files for mcp_server_fetch
PATTERNS = [
    "/home/node/.cache/uv/archive-v0/*/lib/python*/site-packages/mcp_server_fetch/server.py",
    "/home/node/.cache/uv/archive-v0/*/mcp_server_fetch/server.py",
]

targets = []
for pat in PATTERNS:
    targets.extend(glob.glob(pat))

if not targets:
    print("[patch] mcp-server-fetch: no cached server.py found, skipping")
    sys.exit(0)

# The cleaning module to inject at the top of server.py
CLEANING_MODULE = r'''
# ---- Fetch content cleaning (injected by patch) ----
import re as _re

_CLEAN_RE_DASH_LINES = _re.compile(r"^-{3,}\s*$", _re.MULTILINE)
_CLEAN_RE_DECORATION = _re.compile(r"^[=\-#]{4,}\s*$", _re.MULTILINE)
_CLEAN_RE_BROKEN_LINKS = _re.compile(r"\]\(/[^)\n]+\)")
_CLEAN_RE_BLANK_RUNS = _re.compile(r"\n{3,}")
_CLEAN_RE_NAV_BULLETS = _re.compile(r"^\* \S[^\n]{0,25}$\n?", _re.MULTILINE)
_CLEAN_RE_ELEMENTOR = _re.compile(
    r"(?:elementor-action|popup:open|popup:close)[^\s)\]]*", _re.IGNORECASE)
_CLEAN_RE_LOGO_IMG = _re.compile(
    r"!\[[^\]]*(?:logo|icon|avatar|badge|seal|favicon)[^\]]*\]\([^)]*\)", _re.IGNORECASE)
_CLEAN_RE_BARE_IMG_URL = _re.compile(
    r"^\s*(?:!\[[^\]]*\]\([^)]*\)|https?://\S+\.(?:png|jpg|jpeg|gif|svg|webp|ico)(?:\?\S*)?)\s*$",
    _re.MULTILINE | _re.IGNORECASE)
_CLEAN_RE_CTA_LINES = _re.compile(
    r"^\s*(?:View (?:full )?profile|See all \w+|Sign (?:in|up)|Log in|"
    r"Follow|Connect|Message|Share|Report|Claim this|Get directions|"
    r"Write a review|Add a photo|Suggest an edit)\s*$",
    _re.MULTILINE | _re.IGNORECASE)
_CLEAN_RE_COMMENT = _re.compile(
    r"(?:"
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+\d{1,2},?\s+\d{4}\s+at\s+\d{1,2}:\d{2}"
    r"|"
    r"\b\w+\s+says:\s*$"
    r"|"
    r"^\s*Reply\s*$"
    r")",
    _re.MULTILINE | _re.IGNORECASE)

_CLEAN_RE_CITE_FOOTNOTE = _re.compile(r"\[+\d+\]+(?:\(#cite[_\w:./-]*\))?")
_CLEAN_RE_TABLE_SEP = _re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", _re.MULTILINE)
_CLEAN_RE_TABLE_ROW = _re.compile(r"^\s*\|.*\|\s*$", _re.MULTILINE)
_CLEAN_RE_EMPTY_IMG = _re.compile(r"!\[\]\S*")
_CLEAN_RE_BARE_BRACKET = _re.compile(r"\[([^\[\]]+)\](?!\()")
_CLEAN_RE_WIKI_NUMBERED_REF = _re.compile(
    r"^\s*\d+\.\s+(?:\*\*\[?\^|\^)\s*", _re.MULTILINE)


def _strip_comments(text):
    indicators = list(_CLEAN_RE_COMMENT.finditer(text))
    if len(indicators) < 3:
        return text
    for i in range(len(indicators) - 2):
        span = indicators[i + 2].start() - indicators[i].start()
        if span <= 2000:
            cutpoint = text.rfind("\n\n", 0, indicators[i].start())
            if cutpoint > len(text) * 0.15:
                return text[:cutpoint].rstrip()
            break
    return text


def _strip_references_section(text):
    refs = list(_CLEAN_RE_WIKI_NUMBERED_REF.finditer(text))
    if len(refs) < 3:
        return text
    for i in range(len(refs) - 2):
        span = refs[i + 2].start() - refs[i].start()
        if span <= 3000:
            cutpoint = text.rfind("\n\n", 0, refs[i].start())
            if cutpoint > len(text) * 0.2:
                return text[:cutpoint].rstrip()
            break
    return text


def _normalize_md(text):
    text = _CLEAN_RE_CITE_FOOTNOTE.sub("", text)
    text = _re.sub(r"\(#cite[_\w:./-]*\)", "", text)
    text = _re.sub(r"\[+edit\]+(?:\([^\)]*\))?", "", text)
    text = _re.sub(r"\[\*?citation needed\*?\]", "", text)
    text = _re.sub(r'\s*"[^"]{1,60}"\)', "", text)
    text = _CLEAN_RE_EMPTY_IMG.sub("", text)
    text = _CLEAN_RE_TABLE_SEP.sub("", text)
    def _table_row_to_text(m):
        cells = [c.strip() for c in m.group().split("|") if c.strip()]
        return " ".join(cells) if cells else ""
    text = _CLEAN_RE_TABLE_ROW.sub(_table_row_to_text, text)
    text = _re.sub(r"^[=\-]{3,}\s*$", "", text, flags=_re.MULTILINE)
    text = _re.sub(r"^#{1,6}\s+", "", text, flags=_re.MULTILINE)
    text = _re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = _re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = _CLEAN_RE_BARE_BRACKET.sub(r"\1", text)
    text = _re.sub(r"^\s*https?://\S+\s*$", "", text, flags=_re.MULTILINE)
    text = _CLEAN_RE_ELEMENTOR.sub("", text)
    text = _CLEAN_RE_BARE_IMG_URL.sub("", text)
    text = _CLEAN_RE_CTA_LINES.sub("", text)
    text = _re.sub(r"\*{2,3}(.+?)\*{2,3}", r"\1", text)
    text = _re.sub(r"_{2,3}(.+?)_{2,3}", r"\1", text)
    text = _re.sub(r"(?<!\n)\*([^*\n]+)\*", r"\1", text)
    text = _re.sub(r"\*{1,3}(?=\s|$)", "", text)
    text = _re.sub(r"^[\s]*[-*_]{3,}\s*$", "", text, flags=_re.MULTILINE)
    text = _re.sub(r"^\s*[*\-+]\s+", "", text, flags=_re.MULTILINE)
    text = _re.sub(r"^\s*\d+\.\s+", "", text, flags=_re.MULTILINE)
    text = _re.sub(r"`([^`]+)`", r"\1", text)
    text = _re.sub(r"\n{3,}", "\n\n", text)
    text = _re.sub(r"(?<!\n)\n(?!\n)", " ", text)
    text = _re.sub(r" {2,}", " ", text)
    return text.strip()


def _clean_content(content):
    content = _CLEAN_RE_DASH_LINES.sub("", content)
    content = _CLEAN_RE_DECORATION.sub("", content)
    content = _CLEAN_RE_BROKEN_LINKS.sub("]", content)
    content = _CLEAN_RE_NAV_BULLETS.sub("", content)
    content = _CLEAN_RE_ELEMENTOR.sub("", content)
    content = _CLEAN_RE_LOGO_IMG.sub("", content)
    content = _CLEAN_RE_BARE_IMG_URL.sub("", content)
    content = _CLEAN_RE_CTA_LINES.sub("", content)
    content = _CLEAN_RE_BLANK_RUNS.sub("\n\n", content).strip()
    content = _strip_comments(content)
    content = _strip_references_section(content)
    content = _normalize_md(content)
    return content


def clean_and_extract(content):
    if not content or len(content) < 200:
        return content
    return _clean_content(content)

# ---- End fetch content cleaning ----
'''

# The code to patch into call_tool: clean content before windowing
OLD_CALL_TOOL = '''        original_length = len(content)'''
NEW_CALL_TOOL = '''        content = clean_and_extract(content)
        original_length = len(content)'''

errors = []
patched = 0

for path in targets:
    try:
        with open(path, "r") as f:
            src = f.read()

        if "clean_and_extract" in src:
            print(f"[patch] mcp-server-fetch: {path} already patched, skipping")
            patched += 1
            continue

        changed = False

        marker = "from pydantic import BaseModel, Field, AnyUrl"
        if marker in src:
            src = src.replace(marker, marker + "\n" + CLEANING_MODULE, 1)
            changed = True
        else:
            errors.append(f"{path}: import marker not found")
            continue

        if OLD_CALL_TOOL in src:
            src = src.replace(OLD_CALL_TOOL, NEW_CALL_TOOL, 1)
            changed = True
        else:
            errors.append(f"{path}: call_tool marker not found")
            continue

        if changed:
            with open(path, "w") as f:
                f.write(src)
            cache_dir = os.path.join(os.path.dirname(path), "__pycache__")
            if os.path.isdir(cache_dir):
                import shutil
                shutil.rmtree(cache_dir)
            patched += 1
            print(f"[patch] mcp-server-fetch: patched {path}")

    except Exception as e:
        errors.append(f"{path}: {e}")

if errors:
    for e in errors:
        print(f"[patch] WARNING: {e}", file=sys.stderr)

if patched:
    print(f"[patch] mcp-server-fetch: {patched} file(s) patched with content cleaning")
else:
    print("[patch] mcp-server-fetch: no files patched")
    if errors:
        sys.exit(1)
