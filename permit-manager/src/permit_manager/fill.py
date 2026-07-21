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
                cx = (box[0] + box[2]) / 2
                cy = (box[1] + box[3]) / 2 + 3
                page.insert_text((box[0] + 1, cy), "X",
                                 fontsize=entry["place"]["fontsize"], color=(0, 0, 0))
                ff = FilledField(label, target, value)
                (res.low_confidence if conf == "low" else res.filled).append(ff)
            continue

        # ---- text -------------------------------------------------------
        value = _resolve_value(profile, target)
        if not value:
            res.blank.append(BlankField(label, "no-value", target))
            continue

        place = entry["place"]
        value = _shrink_to_width(value, place["fontsize"], place["max_width"])
        page.insert_text((place["x"], place["y"]), value,
                         fontsize=place["fontsize"], color=(0, 0, 0.55))
        ff = FilledField(label, target, value)
        (res.low_confidence if conf == "low" else res.filled).append(ff)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))
    return res


def _shrink_to_width(text: str, fontsize: float, max_width: float) -> str:
    """Truncate with an ellipsis if the text would overrun its blank."""
    if max_width <= 0:
        return text
    while fitz.get_text_length(text, fontsize=fontsize) > max_width and len(text) > 1:
        text = text[:-2] + "…"
    return text


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
