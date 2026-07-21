"""PDF form introspection (PyMuPDF).

Two kinds of source PDF are handled:
  * AcroForm PDFs  -> named widgets (name, type, page, rect, current value)
  * Flat PDFs      -> no widgets; we expose text spans as label anchors so a
                      coordinate-overlay mapping can be built instead.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF


@dataclass
class FormField:
    name: str
    type: str            # Text | CheckBox | RadioButton | Signature | ...
    page: int
    rect: list[float]
    value: str = ""


@dataclass
class TextSpan:
    text: str
    page: int
    rect: list[float]        # [x0, y0, x1, y1]
    baseline_y: float = 0.0  # text baseline (span origin y), for exact alignment


@dataclass
class Introspection:
    path: str
    page_count: int
    has_form_fields: bool
    sha256: str
    fields: list[FormField] = field(default_factory=list)
    spans: list[TextSpan] = field(default_factory=list)


def sha256_of(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def introspect(path: str | Path) -> Introspection:
    path = str(path)
    doc = fitz.open(path)
    fields: list[FormField] = []
    spans: list[TextSpan] = []

    for pno, page in enumerate(doc):
        for w in page.widgets() or []:
            fields.append(FormField(
                name=w.field_name or "",
                type=w.field_type_string,
                page=pno,
                rect=[round(c, 1) for c in w.rect],
                value=w.field_value or "",
            ))
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    t = span["text"].strip()
                    if t:
                        spans.append(TextSpan(
                            text=t, page=pno,
                            rect=[round(c, 1) for c in span["bbox"]],
                            baseline_y=round(span["origin"][1], 1),
                        ))

    return Introspection(
        path=path,
        page_count=doc.page_count,
        has_form_fields=len(fields) > 0,
        sha256=sha256_of(path),
        fields=fields,
        spans=spans,
    )
