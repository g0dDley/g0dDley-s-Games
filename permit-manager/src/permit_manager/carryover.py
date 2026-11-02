"""Carry what someone entered on an earlier copy of a form onto a fresh copy.

Used when a form is remade (new base form, re-fill) but the user has already
typed into, ticked, or signed the old copy: field values are copied by field
name, and images the user placed on the page (e.g. signatures added in
Acrobat) are re-placed at exactly the same position and size.

Text keeps the size it had on the old copy; text typed at "auto" size gets
the mapping's size for that field (so it matches the other entries). Values
are never truncated - if one cannot fit it is reported, not cut.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF

from .acroform import DEFAULT_FS, _check, _fit, _pin_font_size


@dataclass
class CarryResult:
    fields: list[tuple[str, str]] = field(default_factory=list)   # (name, value)
    images: list[tuple[int, tuple]] = field(default_factory=list)  # (page, bbox)
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (name, why)


def _field_values(doc: fitz.Document) -> dict[str, tuple]:
    vals: dict[str, tuple] = {}
    for page in doc:
        for w in page.widgets() or []:
            if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                on = w.on_state()
                vals[w.field_name] = ("check", on if w.field_value == on else None)
            elif w.field_type == fitz.PDF_WIDGET_TYPE_TEXT:
                vals[w.field_name] = ("text", w.field_value or "", w.text_fontsize or 0)
    return vals


def _image_bytes(doc: fitz.Document, xref: int) -> tuple[bytes, bytes | None]:
    """Image file bytes (+ alpha mask as PNG) for an image XObject."""
    info = doc.extract_image(xref)
    mask = None
    smask = info.get("smask") or 0
    if smask:
        mask = fitz.Pixmap(doc, smask).tobytes("png")
    return info["image"], mask


def carry_over(src_pdf: str | Path, dst_pdf: str | Path, out_pdf: str | Path,
               mapping: dict | None = None, *, images: bool = True) -> CarryResult:
    """Copy field values and user-placed images from src onto dst -> out."""
    sizes = {e["pdf_field"]: e["font_size"] for e in (mapping or {}).get("fields", [])
             if "font_size" in e}
    src = fitz.open(src_pdf)
    dst = fitz.open(dst_pdf)
    res = CarryResult()
    old = _field_values(src)

    pages = [dst[i] for i in range(dst.page_count)]
    for page in pages:
        for w in page.widgets() or []:
            if w.field_name not in old:
                continue
            kind, *rest = old[w.field_name]
            if kind == "check" and w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                on = rest[0]
                is_on = w.field_value not in ("Off", False, "")
                if on and on == w.on_state() and not is_on:
                    _check(dst, w, on)
                    res.fields.append((w.field_name, "☒"))
                elif not on and is_on:
                    dst.xref_set_key(w.xref, "AS", "/Off")
                    dst.xref_set_key(w.xref, "V", "/Off")
                    res.fields.append((w.field_name, "☐"))
            elif kind == "text" and w.field_type == fitz.PDF_WIDGET_TYPE_TEXT:
                value, old_fs = rest
                if value == (w.field_value or ""):
                    continue
                if not value:
                    w.field_value = ""
                    w.update()
                    res.fields.append((w.field_name, ""))
                    continue
                start = old_fs if old_fs and old_fs > 0 else sizes.get(w.field_name, DEFAULT_FS)
                multiline = bool(w.field_flags & fitz.PDF_TX_FIELD_IS_MULTILINE)
                fit = _fit(value, w.rect, start, multiline)
                if fit is None:
                    res.skipped.append((w.field_name, f"too long to fit: {value!r}"))
                    continue
                fs, wrapped = fit
                if wrapped and not multiline:
                    w.field_flags |= fitz.PDF_TX_FIELD_IS_MULTILINE
                w.text_font, w.text_fontsize, w.field_value = "Helv", fs, value
                w.update()
                _pin_font_size(dst, w, fs)
                res.fields.append((w.field_name, value))

    if images:
        base_imgs = {(i, round(x["bbox"][0]), round(x["bbox"][1]))
                     for i, pg in enumerate(dst) for x in pg.get_image_info()}
        for i, spage in enumerate(src):
            if i >= dst.page_count:
                break
            for info in spage.get_image_info(xrefs=True):
                bbox = fitz.Rect(info["bbox"])
                if not info.get("xref") or (i, round(bbox.x0), round(bbox.y0)) in base_imgs:
                    continue
                img, mask = _image_bytes(src, info["xref"])
                dst[i].insert_image(bbox, stream=img, mask=mask, keep_proportion=False)
                res.images.append((i + 1, tuple(round(v, 1) for v in bbox)))

    Path(out_pdf).parent.mkdir(parents=True, exist_ok=True)
    dst.save(str(out_pdf), garbage=3, deflate=True)
    return res
