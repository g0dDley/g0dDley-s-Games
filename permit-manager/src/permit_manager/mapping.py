"""Field-mapping agent + cache.

Hybrid strategy:
  * Deterministic name/label matching produces high-confidence mappings that
    are cached automatically.
  * Anything not confidently matched is left ``unmapped`` (never guessed).
    An AI-proposed target may be written into the cache with
    ``confidence: "low"`` for review; the fill step surfaces every low /
    unmapped item in the assumption summary before anything is finalised.

Two fill strategies are supported and recorded per cache file:
  * ``acroform`` - named AcroForm widgets, filled with pypdf.
  * ``overlay``  - flat PDF, text drawn at label-anchored coordinates.

Signature and signature-date fields are always marked ``protected`` and are
never filled, regardless of any mapping.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from .introspect import Introspection, TextSpan

MAPPING_VERSION = 1


# --------------------------------------------------------------------------
# protected-field detection (signatures / signature-dates are never filled)
# --------------------------------------------------------------------------
def is_protected(name_or_label: str, field_type: str = "") -> bool:
    t = (name_or_label or "").lower()
    if field_type.lower() == "signature":
        return True
    if "signature" in t or re.search(r"\bsign(ed|ature)?\b", t):
        return True
    # a bare "Date:" that sits on a signature line
    if re.fullmatch(r"date:?", t.strip()):
        return True
    if "date" in t and ("sign" in t or "signed" in t):
        return True
    return False


def _norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", s.strip().lower())


def find_span(spans: list[TextSpan], text: str, y_hint: float,
              x_hint: float | None = None) -> TextSpan | None:
    """Nearest span (by y, then x) whose normalised text equals ``text``."""
    want = _norm(text)
    cands = [s for s in spans if _norm(s.text) == want]
    if not cands:
        return None

    def cost(s: TextSpan) -> float:
        c = abs(s.rect[1] - y_hint)
        if x_hint is not None:
            c += abs(s.rect[0] - x_hint) * 0.1
        return c

    return min(cands, key=cost)


# --------------------------------------------------------------------------
# cache persistence
# --------------------------------------------------------------------------
def form_id(municipality_slug: str, form_slug: str) -> str:
    return f"{municipality_slug}__{form_slug}"

def cache_path(mappings_dir: str | Path, fid: str) -> Path:
    return Path(mappings_dir) / f"{fid}.json"

def load_mapping(path: str | Path) -> dict:
    return json.loads(Path(path).read_text())

def save_mapping(path: str | Path, mapping: dict) -> None:
    Path(path).write_text(json.dumps(mapping, indent=2, ensure_ascii=False))

def is_stale(mapping: dict, intro: Introspection) -> bool:
    """True if the blank form changed since the mapping was built."""
    return mapping.get("pdf_sha256") != intro.sha256


# --------------------------------------------------------------------------
# overlay mapping for the EABO "Owner Commitment / General Review" form
# --------------------------------------------------------------------------
_DISCIPLINE_X = {            # x0 of each discipline checkbox glyph, per block row
    "ARCHITECTURAL": 36, "STRUCTURAL": 124, "MECHANICAL": 198,
    "ELECTRICAL": 272, "SITE SERVICES": 342, "OTHER": 423,
}
_BLOCKS = 4                  # Part B blocks on the page

PAD_X = 4.0                  # gap between label and inline value
PAD_R = 4.0                  # right-edge padding inside a cell
WRAP_DY = 12.0               # how far below the baseline the wrap line sits


def _txt(target, label, span, col_right, *, protected=False,
         confidence="high", note="", fontsize=8.0, min_fontsize=5.5):
    """Build a text field with an inline slot (right of the label) and a
    wrap slot (a full-width line just below the label, in the row's
    whitespace). The fill step uses inline when the value fits without
    overlapping the next cell, otherwise the wrap slot - never truncating.
    """
    if span is None:
        return None
    inline_x = span.rect[2] + PAD_X
    wrap_x = span.rect[0]
    return {
        "target": None if protected else target,
        "label": label,
        "page": span.page,
        "anchor_rect": span.rect,
        "type": "text",
        "place": {
            "mode": "text",
            "fontsize": fontsize,
            "min_fontsize": min_fontsize,
            "inline": {"x": round(inline_x, 1), "y": round(span.baseline_y, 1),
                       "max_width": round(col_right - inline_x - PAD_R, 1)},
            "wrap": {"x": round(wrap_x, 1), "y": round(span.baseline_y + WRAP_DY, 1),
                     "max_width": round(col_right - wrap_x - PAD_R, 1)},
        },
        "protected": protected,
        "confidence": "n/a" if protected else confidence,
        "note": note,
    }


def build_eabo_overlay_mapping(intro: Introspection, *, municipality: str,
                               form_title: str) -> dict:
    s = intro.spans
    entries: list[dict] = []

    # column-right boundaries (x of the next cell) per row
    # ---- Part A: project + owner + coordinator --------------------------
    # Project description = short project NAME (shortened so it fits at top),
    # never the long scope. col_right=455 keeps clear of the Permit App box.
    entries.append(_txt("project_name", "Project Description:",
                        find_span(s, "Project Description:", 63), 455))
    entries.append(_txt("property_address.__oneline__", "Address of Project:",
                        find_span(s, "Address of Project:", 93, 36), 455))
    entries.append(_txt("municipality.name", "Municipality:",
                        find_span(s, "Municipality:", 93, 459), 578))

    entries.append(_txt("owner.company", "Owner's Company Name:",
                        find_span(s, "Owner’s Company Name:", 300), 234))
    entries.append(_txt("owner.name", "First and Last Name (owner):",
                        find_span(s, "First and Last Name:", 300, 234), 351))
    entries.append(_txt(None, "Signature (owner):",
                        find_span(s, "Signature:", 300, 351), 486, protected=True))
    entries.append(_txt(None, "Date (owner):",
                        find_span(s, "Date:", 300, 486), 578, protected=True))
    entries.append(_txt("owner.address.__oneline__", "Owner's Address:",
                        find_span(s, "Owner's Address:", 329), 234))
    entries.append(_txt("owner.phone", "Telephone (owner):",
                        find_span(s, "Telephone:", 329, 234), 351))
    entries.append(_txt("owner.email", "Email (owner):",
                        find_span(s, "Email:", 329, 450), 578))

    entries.append(_txt("coordinator.company", "Coordinator Company:",
                        find_span(s, "Company name of the coordinator of the work of all "
                                  "architects and professional engineers:", 359), 432))
    entries.append(_txt("coordinator.name", "Coordinator Name:",
                        find_span(s, "First and Last Name:", 359, 432), 578))
    entries.append(_txt("coordinator.address.__oneline__", "Coordinator Address:",
                        find_span(s, "Address:", 389, 36), 234))
    entries.append(_txt("coordinator.phone", "Coordinator Telephone:",
                        find_span(s, "Telephone:", 389, 234), 351))
    entries.append(_txt("coordinator.email", "Coordinator Email:",
                        find_span(s, "Email:", 389, 450), 578))

    # ---- Part B: up to 4 consultant blocks ------------------------------
    company_anchors = sorted(
        (sp for sp in s if _norm(sp.text) == "company name:" and sp.rect[1] > 460),
        key=lambda sp: sp.rect[1],
    )
    for i, comp in enumerate(company_anchors[:_BLOCKS]):
        cy = comp.rect[1]                 # top y of "Company Name:" label
        box_y = cy - 12                   # discipline checkbox row
        # discipline checkbox group (an X is drawn in the matching box)
        options = {
            name: [x, round(box_y, 1), x + 9, round(box_y + 9, 1)]
            for name, x in _DISCIPLINE_X.items()
        }
        entries.append({
            "target": f"consultants.{i}.discipline",
            "label": f"Part B block {i + 1} - discipline",
            "page": comp.page, "anchor_rect": comp.rect,
            "type": "checkbox_group", "options": options,
            "place": {"mode": "mark", "fontsize": 9.0},
            "protected": False, "confidence": "high", "note": "",
        })
        entries.append(_txt(f"consultants.{i}.company", f"Part B{i+1} Company Name:",
                            comp, 234))
        entries.append(_txt(f"consultants.{i}.name", f"Part B{i+1} First and Last Name:",
                            find_span(s, "First and Last Name:", cy, 234), 351))
        entries.append(_txt(None, f"Part B{i+1} Signature:",
                            find_span(s, "Signature:", cy, 351), 486, protected=True))
        entries.append(_txt(None, f"Part B{i+1} Date:",
                            find_span(s, "Date:", cy, 486), 578, protected=True))
        entries.append(_txt(f"consultants.{i}.address.__oneline__", f"Part B{i+1} Address:",
                            find_span(s, "Address:", cy + 29, 36), 234))
        entries.append(_txt(f"consultants.{i}.phone", f"Part B{i+1} Telephone:",
                            find_span(s, "Telephone:", cy + 29, 234), 351))
        entries.append(_txt(f"consultants.{i}.email", f"Part B{i+1} Email:",
                            find_span(s, "Email:", cy + 29, 450), 578))

    # permit application number, top-right box
    entries.append(_txt("permit.application_number", "Permit Application No.:",
                        find_span(s, "Permit Application No.", 63, 485), 576))

    fields = [e for e in entries if e is not None]
    unmatched = [i for i, e in enumerate(entries) if e is None]

    return {
        "form_id": form_id(_slug(municipality), "owner_commitment_general_review"),
        "municipality": municipality,
        "form_title": form_title,
        "source_pdf": intro.path,
        "pdf_sha256": intro.sha256,
        "created": date.today().isoformat(),
        "mapping_version": MAPPING_VERSION,
        "fill_strategy": "overlay",
        "page_size": _page_size(intro),
        "fields": fields,
        "unmapped_fields": [f"anchor #{i} not found on page" for i in unmatched],
    }


def _page_size(intro: Introspection) -> list[float]:
    import fitz
    d = fitz.open(intro.path)
    r = d[0].rect
    return [round(r.width, 1), round(r.height, 1)]


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
