"""Fill agent.

Applies a cached mapping to a project profile:
  * fills only confidently-matched fields,
  * never writes a ``protected`` (signature / signature-date) field,
  * leaves unmapped / empty-value fields blank,
  * returns a structured result for the review / assumption summary.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
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


ROOT = Path(__file__).resolve().parents[2]   # permit-manager/ (for signature assets)


def _resolve_value(profile: ProjectProfile, target: str) -> str:
    """Resolve a mapping target to a display string, honouring the
    ``.__oneline__`` / ``.__streetline__`` sentinels for address values."""
    for suffix, method in ((".__oneline__", "one_line"), (".__streetline__", "street_line")):
        if target.endswith(suffix):
            obj = resolve_path(profile, target[: -len(suffix)])
            if obj is None:
                return ""
            return getattr(obj, method)() if hasattr(obj, method) else str(obj)
    val = resolve_path(profile, target)
    if val is None:
        return ""
    if isinstance(val, list):
        return ", ".join(str(v) for v in val)
    return str(val)


def fill_overlay(mapping: dict, profile: ProjectProfile, out_path: str | Path,
                 *, mapping_source: str = "cached",
                 fill_low_confidence: bool = False,
                 sign_date: str | None = None,
                 apply_signatures: bool = False) -> FillResult:
    # By default NO signatures are placed - signature and date fields are left
    # blank for manual signing. (apply_signatures kept for future use.)
    doc = fitz.open(mapping["source_pdf"])
    res = FillResult(output_pdf=str(out_path), mapping_source=mapping_source)
    today = sign_date or date.today().isoformat()   # date beside an authorised signature

    for entry in mapping["fields"]:
        label = entry["label"]
        page = doc[entry["page"]]

        etype = entry.get("type")

        # ---- signature image (only when explicitly authorised) ----------
        if etype == "signature":
            _handle_signature(page, entry, profile, res, apply_signatures)
            continue
        if etype == "sig_date":
            _handle_sig_date(page, entry, profile, res, today, apply_signatures)
            continue

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


def _authorized_signer(profile: ProjectProfile, sig_target: str):
    """Return the party if their signature is authorised AND on file, else None,
    plus a flag for whether the field routes out to a signer."""
    who = resolve_path(profile, sig_target) if sig_target else None
    if who is None:
        return None, False
    authorized = (getattr(who, "signature_authorized", False)
                  and getattr(who, "signature_asset", ""))
    routes_out = getattr(who, "signature_required", False) and not authorized
    return (who if authorized else None), routes_out


def _handle_signature(page, entry, profile, res, apply_signatures=False):
    label = entry["label"]
    who, routes_out = _authorized_signer(profile, entry.get("sig_target"))
    if not apply_signatures:
        who = None                     # signatures are added manually
    if who is None:
        # never sign on someone's behalf without authorisation
        res.blank.append(BlankField(label, "awaiting-signature" if routes_out else "protected",
                                    entry.get("sig_target", "")))
        return
    asset = ROOT / who.signature_asset
    if not asset.exists():
        res.blank.append(BlankField(label, "awaiting-signature", entry.get("sig_target", "")))
        return
    page.insert_image(fitz.Rect(entry["sig_box"]), filename=str(asset),
                      keep_proportion=True, overlay=True)
    res.filled.append(FilledField(label, entry["sig_target"],
                                  f"[authorised signature: {who.name}]", placement="signature"))


def _handle_sig_date(page, entry, profile, res, today, apply_signatures=False):
    label = entry["label"]
    who, routes_out = _authorized_signer(profile, entry.get("sig_target"))
    if not apply_signatures:
        who = None                     # dates accompany manual signatures
    # date beside an authorised signature is always today's date
    value = today if who else ""
    if not value:
        res.blank.append(BlankField(label, "awaiting-signature" if routes_out else "protected",
                                    entry.get("sig_target", "")))
        return
    _place_text(page, value, entry["place"], _TEXT_COLOR)
    res.filled.append(FilledField(label, entry.get("sig_target", "") + ".signature_date",
                                  value, placement="inline"))


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
