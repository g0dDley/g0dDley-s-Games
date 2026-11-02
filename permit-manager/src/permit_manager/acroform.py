"""AcroForm fill agent (PyMuPDF).

Fills named form fields from a mapping, with the same guardrails as the overlay
filler:
  * only mapped fields are touched; everything else is left exactly as-is;
  * signature / signature-date fields are never written;
  * values are NEVER truncated - text shrinks to fit (down to a floor), or
    wraps onto extra lines when the field is tall enough; if it still cannot
    fit it is left blank and reported, never cut off;
  * the output stays a live, editable PDF form (so it can still be signed).

Mapping entry shapes (``fields`` list of a cache file with fill_strategy
"acroform"):
  text      {"pdf_field", "label", "target"}            value from profile path
  constant  {"pdf_field", "label", "const"}              literal value
  checkbox  {"pdf_field", "label", "on", "when": {...}}  checks the widget whose
            on-state is ``on`` when the condition holds. Conditions:
              {"target": path, "equals": v}  /  {"target": path, "contains": v}
            If the target is unknown (None/empty) the box is left blank and
            reported as needing manual entry.
  protected {"pdf_field", "label", "protected": true}    never written
"""
from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF

from .fill import BlankField, FilledField, FillResult, _resolve_value
from .schema import ProjectProfile, resolve_path

MIN_FS = 6.0
DEFAULT_FS = 10.0
PAD = 2.0


def _wrap(text: str, width: float, fs: float) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split(" "):
            trial = f"{cur} {word}".strip()
            if fitz.get_text_length(trial, fontname="helv", fontsize=fs) <= width or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines


def _fit(text: str, rect: fitz.Rect, start_fs: float, multiline: bool):
    """Return (fontsize, multiline) that fits the whole text, or None."""
    width = rect.width - 2 * PAD
    height = rect.height - PAD
    fs = start_fs
    while fs >= MIN_FS:
        if fitz.get_text_length(text, fontname="helv", fontsize=fs) <= width and "\n" not in text:
            if fs * 1.1 <= rect.height:          # single line fits
                return fs, multiline
        n = len(_wrap(text, width, fs))            # try wrapping
        if n * fs * 1.18 <= height and n > 1:
            return fs, True
        fs = round(fs - 0.5, 2)
    return None


def _check(doc: fitz.Document, w, on_raw: str) -> None:
    """Tick a checkbox / radio kid by writing its appearance state and the
    field value at the PDF level. (Setting field_value through the widget API
    double-escapes on-state names containing '#20' etc., silently leaving the
    box unticked.) `on_raw` is the on-state exactly as PyMuPDF reports it,
    i.e. already in PDF name syntax."""
    name = "/" + on_raw
    doc.xref_set_key(w.xref, "AS", name)
    kind, val = doc.xref_get_key(w.xref, "Parent")
    if kind == "xref":
        doc.xref_set_key(int(val.split()[0]), "V", name)
    else:
        doc.xref_set_key(w.xref, "V", name)


def _condition(profile: ProjectProfile, cond: dict):
    """True / False, or None when the target value is unknown."""
    val = resolve_path(profile, cond["target"])
    if val is None or val == "" or val == []:
        return None
    if "equals" in cond:
        return val == cond["equals"]
    if "contains" in cond:
        if isinstance(val, (list, tuple)):
            return cond["contains"] in val
        return str(cond["contains"]).lower() in str(val).lower()
    return bool(val)


def fill_acroform_widgets(mapping: dict, profile: ProjectProfile, out_path: str | Path,
                          *, mapping_source: str = "cached") -> FillResult:
    doc = fitz.open(mapping["source_pdf"])
    res = FillResult(output_pdf=str(out_path), mapping_source=mapping_source)

    # index widgets by field name (checkbox groups share a name). Keep the page
    # objects referenced - a widget becomes unusable once its page is collected.
    pages = [doc[i] for i in range(doc.page_count)]
    widgets: dict[str, list] = {}
    for page in pages:
        for w in page.widgets() or []:
            widgets.setdefault(w.field_name, []).append(w)

    reported_unknown: set[str] = set()
    for entry in mapping["fields"]:
        name, label = entry["pdf_field"], entry.get("label", entry["pdf_field"])
        ws = widgets.get(name)
        if not ws:
            res.blank.append(BlankField(label, "unmapped", f"(field '{name}' not found)"))
            continue
        if entry.get("protected"):
            res.blank.append(BlankField(label, "protected"))
            continue

        # ---- checkbox / radio --------------------------------------------
        if "on" in entry:
            ok = _condition(profile, entry["when"]) if "when" in entry else True
            if ok is None:
                key = entry["when"]["target"]
                if key not in reported_unknown:      # report each question once
                    reported_unknown.add(key)
                    res.blank.append(BlankField(entry.get("group_label", label), "no-value", key))
                continue
            if not ok:
                continue                              # not applicable -> stays unchecked
            target_w = next((w for w in ws if w.on_state() == entry["on"]), None)
            if target_w is None:
                res.blank.append(BlankField(label, "unmapped", f"(no on-state '{entry['on']}')"))
                continue
            _check(doc, target_w, entry["on"])
            res.filled.append(FilledField(label, entry["when"]["target"] if "when" in entry else "const",
                                          "☒ " + entry["on"].replace("#20", " ").replace("#2F", "/"),
                                          placement="checkbox"))
            continue

        # ---- text ----------------------------------------------------------
        if "const" in entry:
            value, target = str(entry["const"]), "const"
        else:
            target = entry["target"]
            value = _resolve_value(profile, target).strip()
        if not value:
            res.blank.append(BlankField(label, "no-value", target))
            continue

        w = ws[0]
        multiline = bool(w.field_flags & fitz.PDF_TX_FIELD_IS_MULTILINE)
        start = w.text_fontsize if w.text_fontsize and w.text_fontsize > 0 else DEFAULT_FS
        fit = _fit(value, w.rect, min(start, 11.0), multiline)
        if fit is None:
            res.blank.append(BlankField(label, "overflow", f"{target} = {value!r}"))
            continue
        fs, need_multi = fit
        if need_multi and not multiline:
            w.field_flags |= fitz.PDF_TX_FIELD_IS_MULTILINE
        w.text_font = "Helv"
        w.text_fontsize = fs
        w.field_value = value
        w.update()
        res.filled.append(FilledField(label, target, value,
                                      placement="wrap-below" if need_multi else "inline"))

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path), garbage=3, deflate=True)
    return res
