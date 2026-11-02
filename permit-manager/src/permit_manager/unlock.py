"""Make a saved form editable again.

Acrobat's Fill & Sign tool, when it saves a signature, merges the signature
into the page and marks EVERY form field read-only (and leaves an
/ADBE_FillSignInfo marker in the catalog). The values are all still there -
they just can't be changed. `unlock_form` clears the read-only flag on every
field so the form can keep being filled and re-signed, without touching the
values, the page content or any placed signature images.

A real digital (certificate) signature is different: changing the file would
invalidate it, so if one is present the file is left alone and reported.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

READ_ONLY = 1          # field flag bit 1 (PDF 32000-1, table 221)


@dataclass
class UnlockResult:
    unlocked: int = 0              # fields whose read-only flag was cleared
    fill_sign_marker: bool = False  # Acrobat Fill & Sign had locked it
    digitally_signed: list[str] | None = None   # set -> file left unchanged
    output: str = ""


def _drop_key(doc: fitz.Document, xref: int, key: str) -> None:
    """Remove a key outright (setting it to null leaves '/Key null' behind)."""
    src = doc.xref_object(xref, compressed=False)
    new = re.sub(rf"/{key}\s+(<<(?:[^<>]|<<[^<>]*>>)*>>|\d+\s+\d+\s+R|null|\d+)\s*", "", src, count=1)
    if new != src:
        doc.update_object(xref, new)


def _field_dicts(doc: fitz.Document) -> list[int]:
    """xrefs of every field dictionary (terminal fields and their parents)."""
    seen: set[int] = set()
    k, v = doc.xref_get_key(doc.pdf_catalog(), "AcroForm")
    if k == "xref":
        af = int(v.split()[0])
    elif k == "dict":
        af = None
    else:
        return []
    stack: list[int] = []
    fields = doc.xref_get_key(af, "Fields")[1] if af else doc.xref_get_key(doc.pdf_catalog(), "AcroForm/Fields")[1]
    stack += [int(x) for x in fields.strip("[]").replace("0 R", " ").split()] if fields not in ("null", "") else []
    while stack:
        x = stack.pop()
        if x in seen:
            continue
        seen.add(x)
        kind, kids = doc.xref_get_key(x, "Kids")
        if kind == "array":
            stack += [int(y) for y in kids.strip("[]").replace("0 R", " ").split()]
    # widgets reachable only through pages (some writers omit them from /Fields)
    for page in doc:
        for w in page.widgets() or []:
            seen.add(w.xref)
    return sorted(seen)


def unlock_form(pdf_in: str | Path, pdf_out: str | Path | None = None) -> UnlockResult:
    """Clear read-only flags on all fields. Writes to pdf_out (default: in place)."""
    pdf_out = Path(pdf_out or pdf_in)
    doc = fitz.open(pdf_in)
    res = UnlockResult(output=str(pdf_out))

    signed = []
    for page in doc:
        for w in page.widgets() or []:
            if w.field_type == fitz.PDF_WIDGET_TYPE_SIGNATURE and \
                    doc.xref_get_key(w.xref, "V")[0] not in ("null", "none"):
                signed.append(w.field_name)
    if signed:
        res.digitally_signed = signed
        return res

    cat = doc.pdf_catalog()
    res.fill_sign_marker = doc.xref_get_key(cat, "ADBE_FillSignInfo")[0] != "null"
    for x in _field_dicts(doc):
        kind, val = doc.xref_get_key(x, "Ff")
        if kind == "int" and int(val) & READ_ONLY:
            doc.xref_set_key(x, "Ff", str(int(val) & ~READ_ONLY))
            res.unlocked += 1
    if res.fill_sign_marker:
        _drop_key(doc, cat, "ADBE_FillSignInfo")
    # no digital signatures exist -> don't advertise any
    k, v = doc.xref_get_key(cat, "AcroForm")
    if k == "xref":
        _drop_key(doc, int(v.split()[0]), "SigFlags")

    tmp = pdf_out.with_name(pdf_out.name + ".tmp")
    doc.save(str(tmp), garbage=3, deflate=True)
    doc.close()
    tmp.replace(pdf_out)
    return res
