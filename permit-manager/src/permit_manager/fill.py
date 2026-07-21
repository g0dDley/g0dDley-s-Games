"""Fill agent.

Applies a cached mapping to a project profile:
  * fills only confidently-matched fields,
  * never writes a ``protected`` (signature / signature-date) field,
  * leaves unmapped / empty-value fields blank,
  * returns a structured result for the review / assumption summary.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF

from .schema import ProjectProfile, resolve_path


@dataclass
class FilledField:
    label: str
    target: str
    value: str
    placement: str = "inline"   # "inline" | "wrap-below" | "checkbox"

@dataclass
class BlankField:
    label: str
    reason: str          # "protected" | "unmapped" | "no-value" | "low-confidence-skipped"
    target: str = ""

@dataclass
class FillResult:
    output_pdf: str
    mapping_source: str          # "new" | "cached"
    filled: list[FilledField] = field(default_factory=list)
    blank: list[BlankField] = field(default_factory=list)
    low_confidence: list[FilledField] = field(default_factory=list)

    def summary_counts(self) -> dict:
        return {
            "filled": len(self.filled),
            "left_blank": len(self.blank),
            "low_confidence": len(self.low_confidence),
        }


def _resolve_value(profile: ProjectProfile, target: str) -> str:
    """Resolve a mapping target to a display string, honouring the
    ``.__oneline__`` sentinel for composite address/description values."""
    if target.endswith(".__oneline__"):
        obj = resolve_path(profile, target[: -len(".__oneline__")])
        if obj is None:
            return ""
        return obj.one_line() if hasattr(obj, "one_line") else str(obj)
    val = resolve_path(profile, target)
    if val is None:
        return ""
    if isinstance(val, list):
        return ", ".join(str(v) for v in val)
    return str(val)


def fill_overlay(mapping: dict, profile: ProjectProfile, out_path: str | Path,
                 *, mapping_source: str = "cached",
                 fill_low_confidence: bool = False) -> FillResult:
    doc = fitz.open(mapping["source_pdf"])
    res = FillResult(output_pdf=str(out_path), mapping_source=mapping_source)

    for entry in mapping["fields"]:
        label = entry["label"]
        page = doc[entry["page"]]

        if entry.get("protected"):
            res.blank.append(BlankField(label, "protected"))
            continue

        target = entry.get("target")
        if not target:
            res.blank.append(BlankField(label, "unmapped"))
            continue

        conf = entry.get("confidence", "high")
        if conf == "low" and not fill_low_confidence:
            res.blank.append(BlankField(label, "low-confidence-skipped", target))
            continue

        # ---- checkbox group (discipline) --------------------------------
        if entry["type"] == "checkbox_group":
            value = _resolve_value(profile, target)
            box = entry["options"].get(value)
            if not value:
                res.blank.append(BlankField(label, "no-value", target))
            elif not box:
                res.blank.append(BlankField(label, "no-value", target))
            else:
                cy = (box[1] + box[3]) / 2 + 3
                page.insert_text((box[0] + 1, cy), "X",
                                 fontsize=entry["place"]["fontsize"], color=(0, 0, 0))
                ff = FilledField(label, target, value, placement="checkbox")
                (res.low_confidence if conf == "low" else res.filled).append(ff)
            continue

        # ---- text -------------------------------------------------------
        value = _resolve_value(profile, target)
        if not value:
            res.blank.append(BlankField(label, "no-value", target))
            continue

        placement = _place_text(page, value, entry["place"], _TEXT_COLOR)
        ff = FilledField(label, target, value, placement=placement)
        (res.low_confidence if conf == "low" else res.filled).append(ff)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))
    return res


_TEXT_COLOR = (0.0, 0.0, 0.55)  # subtle blue, distinct from the printed form


def _place_text(page, value: str, place: dict, color) -> str:
    """Place ``value`` without ever truncating and without overlapping the
    next cell. Inline if it fits; otherwise on the wrap line below the label,
    shrinking the font (down to a floor) or, as a last resort, breaking into
    stacked lines. Returns the placement used.
    """
    fs = place["fontsize"]
    floor = place.get("min_fontsize", 5.5)
    inline, wrap = place["inline"], place["wrap"]

    if fitz.get_text_length(value, fontsize=fs) <= inline["max_width"]:
        page.insert_text((inline["x"], inline["y"]), value, fontsize=fs, color=color)
        return "inline"

    # wrap below: shrink font until the whole value fits the wider wrap slot
    cur = fs
    while cur > floor and fitz.get_text_length(value, fontsize=cur) > wrap["max_width"]:
        cur = round(cur - 0.5, 2)

    if fitz.get_text_length(value, fontsize=cur) <= wrap["max_width"]:
        page.insert_text((wrap["x"], wrap["y"]), value, fontsize=cur, color=color)
        return "wrap-below"

    # last resort (very long values): stack full words across multiple lines,
    # still never truncating a character.
    y = wrap["y"]
    for line in _word_wrap(value, wrap["max_width"], floor):
        page.insert_text((wrap["x"], y), line, fontsize=floor, color=color)
        y += floor + 1.5
    return "wrap-below"


def _word_wrap(value: str, max_width: float, fontsize: float) -> list[str]:
    words, lines, cur = value.split(" "), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if fitz.get_text_length(trial, fontsize=fontsize) <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_preview(pdf_path: str | Path, out_png: str | Path,
                   page_index: int = 0, dpi: int = 130) -> str:
    """Render a filled page to PNG so placement can be eyeballed in review."""
    doc = fitz.open(str(pdf_path))
    pix = doc[page_index].get_pixmap(dpi=dpi)
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(out_png))
    return str(out_png)


# --------------------------------------------------------------------------
# AcroForm fill (for future fillable forms), kept minimal for now
# --------------------------------------------------------------------------
def fill_acroform(mapping: dict, profile: ProjectProfile, out_path: str | Path,
                  *, mapping_source: str = "cached") -> FillResult:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(mapping["source_pdf"])
    writer = PdfWriter()
    writer.append(reader)

    res = FillResult(output_pdf=str(out_path), mapping_source=mapping_source)
    values: dict[str, str] = {}

    for entry in mapping["fields"]:
        name, label = entry["pdf_field"], entry.get("label", entry["pdf_field"])
        if entry.get("protected"):
            res.blank.append(BlankField(label, "protected")); continue
        target = entry.get("target")
        if not target:
            res.blank.append(BlankField(label, "unmapped")); continue
        value = _resolve_value(profile, target)
        if not value:
            res.blank.append(BlankField(label, "no-value", target)); continue
        values[name] = value
        res.filled.append(FilledField(label, target, value))

    for page in writer.pages:
        writer.update_page_form_field_values(page, values)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as fh:
        writer.write(fh)
    return res
