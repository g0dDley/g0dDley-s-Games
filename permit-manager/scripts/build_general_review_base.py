"""Build the standard Ontario Commitment to General Review base form + mapping.

This is the base form used for EVERY project in Ontario outside the City of
Toronto (unless a project says otherwise). It is built from the flat EABO
"Commitment to General Review by Architect and Engineer" (08/2008) and is
fully fillable - every blank is a live form field, so the filled copy stays
editable in Acrobat:

  page 1  the original form, with fields for Part A and Part B blocks 1-4
  page 2  "Part B - Continued": the page-1 header (title + solid black line),
          then blocks 5 and 6 for two more consultants (no Part A, no blurb)

Field naming:
  A_*                       Part A (owner / coordinator)
  B{n}_Architectural ...    discipline checkboxes for Part B block n (1-6)
  B{n}_ConsultantName / _Signature / _PrintName / _Date / _Telephone /
  B{n}_Address / _OtherDescription

Signature fields are real (unsigned) signature fields; signatures and dates
are never filled by the tool.

Run:  PYTHONPATH=src python scripts/build_general_review_base.py
Writes:
  forms/blank/ontario/commitment_general_review_eabo_fillable.pdf
  mappings/ontario__commitment_general_review.json
"""
from __future__ import annotations

import hashlib
import json
import sys
import warnings
from datetime import date
from pathlib import Path

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pymupdf as fitz  # noqa: E402

SRC = ROOT / "forms/blank/ontario/source/eabo_commitment_general_review_2008_flat.pdf"
OUT = ROOT / "forms/blank/ontario/commitment_general_review_eabo_fillable.pdf"
MAP = ROOT / "mappings/ontario__commitment_general_review.json"
FORM_ID = "ontario__commitment_general_review"
TITLE = "Commitment to General Review by Architect and Engineer"

LABEL_GREY = (0.199, 0.199, 0.199)        # Part A/B label box colour on the form
X_RIGHT = 577.0

# ---- Part B block geometry on page 1 (y of: discipline row top, consultant
# row top, thin rule, telephone row top, thick bottom rule) -------------------
P1_BLOCKS = [
    dict(opt=442.7, name=452.2, thin=478.4, tel=481.4, bottom=508.6),
    dict(opt=514.1, name=523.6, thin=559.1, tel=562.0, bottom=589.2),
    dict(opt=594.8, name=604.2, thin=639.7, tel=642.6, bottom=669.8),
    dict(opt=675.4, name=684.9, thin=720.4, tel=723.3, bottom=752.8),
]
# x of the discipline tick glyph in each block (block 4's STRUCTURAL is offset)
DISC_X = [36.2, 128.5, 207.2, 290.5, 369.2, 450.2]
DISC_X_B4 = [36.2, 137.5, 207.2, 291.0, 369.2, 450.2]
DISCIPLINES = [("Architectural", "ARCHITECTURAL"), ("Structural", "STRUCTURAL"),
               ("Mechanical", "MECHANICAL"), ("Electrical", "ELECTRICAL"),
               ("SiteServices", "SITE SERVICES"), ("Other", "OTHER")]

# page 2: block 2 of page 1 (clean thick-rule-to-thick-rule band) is reused
BAND = fitz.Rect(0, 510.4, 612, 590.6)
HEADER = fitz.Rect(0, 0, 612, 60.85)    # title + black rule (stops above the Part A boxes)
FOOTER = fitz.Rect(0, 752.5, 612, 792)
P2_BLOCK_TOP = 74.0


# ----------------------------------------------------------------- widgets
def text_field(page, name, rect, tip):
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.field_name = name
    w.field_label = tip
    w.rect = fitz.Rect(rect)
    w.text_font = "Helv"
    w.text_fontsize = 0                      # auto-size when typed in Acrobat
    w.text_color = (0, 0, 0)
    w.border_width = 0
    w.field_flags = fitz.PDF_TX_FIELD_IS_MULTILINE   # top-aligned, wraps
    page.add_widget(w)


def checkbox(page, name, x, y, tip):
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_CHECKBOX
    w.field_name = name
    w.field_label = tip
    w.rect = fitz.Rect(x - 1.0, y + 0.6, x + 6.0, y + 7.6)
    w.border_color = (0, 0, 0)
    w.border_width = 0.5
    w.field_value = False
    page.add_widget(w)


def signature(page, name, rect, tip):
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_SIGNATURE
    w.field_name = name
    w.field_label = tip
    w.rect = fitz.Rect(rect)
    page.add_widget(w)


def blank_signature_appearances(doc) -> None:
    """MuPDF draws an orange 'SIGN' tab as the appearance of an unsigned
    signature field - it would print. Give every signature field an empty
    appearance instead (Acrobat still shows it as a clickable sign field)."""
    for page in doc:
        for w in page.widgets():
            if w.field_type != fitz.PDF_WIDGET_TYPE_SIGNATURE:
                continue
            r = w.rect
            ap = doc.get_new_xref()
            doc.update_object(ap, f"<</Type/XObject/Subtype/Form/BBox[0 0 {r.width:.2f} {r.height:.2f}]>>")
            doc.update_stream(ap, b" ")
            doc.xref_set_key(w.xref, "AP", f"<</N {ap} 0 R>>")


def _drop_key(doc, xref: int, key: str) -> None:
    """Remove a key from a dictionary object outright (setting it to null
    leaves '/Key null' behind, which some PDF readers reject)."""
    import re
    src = doc.xref_object(xref, compressed=False)
    new = re.sub(rf"/{key}\s+(\d+\s+\d+\s+R|null|\d+)\s*", "", src)
    if new != src:
        doc.update_object(xref, new)


def merge_field_dicts(path: Path) -> None:
    """PyMuPDF 2 creates each new field as a parent field dict + one widget
    kid. Fold every single-kid parent into its widget (the classic merged
    field/widget layout every viewer and the filler handle reliably - with the
    split layout a widget's font size never reaches the field's /DA)."""
    doc = fitz.open(path)
    swap: dict[int, int] = {}
    for page in doc:
        for w in page.widgets():
            kind, val = doc.xref_get_key(w.xref, "Parent")
            if kind != "xref":
                continue
            parent = int(val.split()[0])
            kids = doc.xref_get_key(parent, "Kids")[1]
            if kids.count(" R") != 1:
                continue
            for key in doc.xref_get_keys(parent):
                if key in ("Kids", "Parent"):
                    continue
                t, v = doc.xref_get_key(parent, key)
                doc.xref_set_key(w.xref, key, fitz.get_pdf_str(v) if t == "string" else v)
            _drop_key(doc, w.xref, "Parent")
            swap[parent] = w.xref
    af = doc.pdf_catalog()
    af = int(doc.xref_get_key(af, "AcroForm")[1].split()[0])
    fields = [int(x) for x in doc.xref_get_key(af, "Fields")[1].strip("[]").replace("0 R", "").split()]
    doc.xref_set_key(af, "Fields", "[" + " ".join(f"{swap.get(x, x)} 0 R" for x in fields) + "]")
    # no signatures exist yet - let the viewer set SigFlags when someone signs
    _drop_key(doc, af, "SigFlags")
    tmp = path.with_suffix(".tmp.pdf")
    doc.save(tmp, garbage=4, deflate=True)
    doc.close()
    tmp.replace(path)


def part_b_block(page, n, g, disc_x):
    """Fields for Part B block n using row geometry g."""
    for (key, label), x in zip(DISCIPLINES, disc_x):
        checkbox(page, f"B{n}_{key}", x, g["opt"], f"Part B block {n}: {label}")
    text_field(page, f"B{n}_OtherDescription", (488, g["opt"] - 2.0, X_RIGHT, g["opt"] + 8.5),
               f"Part B block {n}: Other - describe")
    top, low = g["name"] - 1.5, g["thin"] - 0.8
    text_field(page, f"B{n}_ConsultantName", (103, top, 232, low), f"Part B block {n}: Consultant name")
    signature(page, f"B{n}_Signature", (274, top, 349, low), f"Part B block {n}: Signature")
    text_field(page, f"B{n}_PrintName", (397, top, 484, low), f"Part B block {n}: Print name")
    text_field(page, f"B{n}_Date", (509, top, X_RIGHT, low), f"Part B block {n}: Date")
    top, low = g["tel"] - 1.5, g["bottom"] - 0.8
    text_field(page, f"B{n}_Telephone", (79, top, 232, low), f"Part B block {n}: Telephone")
    text_field(page, f"B{n}_Address", (269, top, X_RIGHT, low), f"Part B block {n}: Address")


def part_a(page):
    T = text_field
    T(page, "A_ProjectDescription", (118, 71.0, 456, 98.4), "Project description")
    T(page, "A_PermitApplicationNo", (461, 76.0, 574, 96.0), "Permit application no.")
    T(page, "A_AddressOfProject", (116, 99.6, 456, 126.4), "Address of project")
    T(page, "A_Municipality", (512, 99.6, X_RIGHT, 126.4), "Municipality")
    T(page, "A_OwnerName", (102, 275.4, 428, 299.4), "Owner's name")
    T(page, "A_OwnerDate", (458, 275.4, X_RIGHT, 299.4), "Owner - date")
    T(page, "A_OwnerAddress", (111, 300.9, 428, 325.0), "Owner's address")
    T(page, "A_OwnerTelephone", (481, 300.9, X_RIGHT, 325.0), "Owner's telephone")
    signature(page, "A_OwnerSignature", (120, 326.6, 286, 354.0), "Signature of owner (or authorized agent)")
    T(page, "A_OwnerPrintName", (340, 326.6, 430, 354.0), "Owner - print name")
    T(page, "A_OwnerFax", (453, 326.6, X_RIGHT, 354.0), "Owner's fax")
    T(page, "A_Coordinator", (206, 355.7, 430, 377.0), "Coordinator of the work of all consultants")
    T(page, "A_CoordinatorTelephone", (481, 355.7, X_RIGHT, 377.0), "Coordinator's telephone")
    T(page, "A_CoordinatorAddress", (76, 377.0, 430, 398.0), "Coordinator's address")
    T(page, "A_CoordinatorFax", (453, 377.0, X_RIGHT, 398.0), "Coordinator's fax")


# ----------------------------------------------------------------- build pdf
def build_pdf() -> int:
    # a text-free copy of page 1 outside the regions reused on page 2, so the
    # continuation page carries no hidden Part A / blurb text
    clean = fitz.open(SRC)
    cp = clean[0]
    for r in (fitz.Rect(0, HEADER.y1, 612, BAND.y0 - 0.2), fitz.Rect(0, BAND.y1 + 0.2, 612, FOOTER.y0)):
        cp.add_redact_annot(r, fill=False)
    cp.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                        graphics=fitz.PDF_REDACT_LINE_ART_NONE)

    doc = fitz.open(SRC)
    p1 = doc[0]
    p2 = doc.new_page(width=p1.rect.width, height=p1.rect.height)

    # header (title + solid black rule) and footer, exactly as on page 1
    p2.show_pdf_page(HEADER, clean, 0, clip=HEADER)
    p2.show_pdf_page(FOOTER, clean, 0, clip=FOOTER)

    # "PART B - CONTINUED" label, styled like the form's Part A/B labels
    label = "PART B – CONTINUED"
    font = fitz.Font("hebi")
    tw = font.text_length(label, fontsize=8)
    box = fitz.Rect(36.0, 61.9, 36.0 + tw + 1.0, 71.3)
    p2.draw_rect(box, color=None, fill=LABEL_GREY)
    tw_ = fitz.TextWriter(p2.rect)
    tw_.append((36.0, 69.3), label, font=font, fontsize=8)
    tw_.write_text(p2, color=(1, 1, 1))

    # blocks 5 and 6 (copies of a page-1 block band)
    p2_blocks = []
    for i in range(2):
        top = P2_BLOCK_TOP + i * BAND.height
        dest = fitz.Rect(0, top, 612, top + BAND.height)
        p2.show_pdf_page(dest, clean, 0, clip=BAND)
        dy = top - BAND.y0
        p2_blocks.append({k: v + dy for k, v in P1_BLOCKS[1].items()})

    # fields (re-fetch pages: adding a page invalidates earlier page handles)
    p1, p2 = doc[0], doc[1]
    part_a(p1)
    for n, g in enumerate(P1_BLOCKS, start=1):
        part_b_block(p1, n, g, DISC_X_B4 if n == 4 else DISC_X)
    for n, g in enumerate(p2_blocks, start=5):
        part_b_block(p2, n, g, DISC_X)

    blank_signature_appearances(doc)
    doc.set_metadata({**doc.metadata, "title": TITLE,
                      "subject": "EABO standard form (08/2008) - fillable base, Part B continued on page 2"})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT, garbage=4, deflate=True)
    doc.close()
    merge_field_dicts(OUT)
    return sum(len(list(pg.widgets())) for pg in fitz.open(OUT))


# ----------------------------------------------------------------- mapping
def build_mapping() -> dict:
    A = 9.0   # value size next to the 9 pt Part A labels
    B = 8.5   # value size next to the 8 pt Part B labels
    f = []

    def T(field, label, target, fs, **kw):
        f.append({"pdf_field": field, "label": label, "target": target, "font_size": fs, **kw})

    def P(field, label, **kw):
        f.append({"pdf_field": field, "label": label, "protected": True, **kw})

    T("A_ProjectDescription", "Part A: Project Description", "project_name", A)
    T("A_PermitApplicationNo", "Part A: Permit Application No.", "permit.application_number", A,
      optional=True)
    T("A_AddressOfProject", "Part A: Address of Project", "property_address.__oneline__", A)
    T("A_Municipality", "Part A: Municipality", "municipality.name", A)
    T("A_OwnerName", "Part A: Owner's Name", "owner.company", A)
    P("A_OwnerDate", "Part A: Owner - Date")
    T("A_OwnerAddress", "Part A: Owner's Address", "owner.address.__oneline__", A)
    T("A_OwnerTelephone", "Part A: Owner's Telephone", "owner.phone", A)
    P("A_OwnerSignature", "Part A: Signature of Owner")
    T("A_OwnerPrintName", "Part A: Owner - Print Name", "owner.name", A)
    T("A_OwnerFax", "Part A: Owner's Fax", "owner.fax", A, optional=True)
    T("A_Coordinator", "Part A: Coordinator of the work of all consultants", "coordinator.company", A)
    T("A_CoordinatorTelephone", "Part A: Coordinator - Telephone", "coordinator.phone", A)
    T("A_CoordinatorAddress", "Part A: Coordinator - Address", "coordinator.address.__oneline__", A)
    T("A_CoordinatorFax", "Part A: Coordinator - Fax", "coordinator.fax", A, optional=True)

    for n in range(1, 7):
        i = n - 1
        req = f"consultants.{i}"
        for key, label in DISCIPLINES:
            f.append({"pdf_field": f"B{n}_{key}", "label": f"Part B{n}: {label}", "on": "Yes",
                      "when": {"target": f"{req}.discipline", "equals": label},
                      "group_label": f"Part B{n}: discipline", "requires": req})
        T(f"B{n}_OtherDescription", f"Part B{n}: Other (describe)", f"{req}.discipline_other", B,
          requires=req, optional=True)
        T(f"B{n}_ConsultantName", f"Part B{n}: Consultant Name", f"{req}.company", B, requires=req)
        P(f"B{n}_Signature", f"Part B{n}: Signature", requires=req)
        T(f"B{n}_PrintName", f"Part B{n}: Print Name", f"{req}.name", B, requires=req)
        P(f"B{n}_Date", f"Part B{n}: Date", requires=req)
        T(f"B{n}_Telephone", f"Part B{n}: Telephone", f"{req}.phone", B, requires=req)
        T(f"B{n}_Address", f"Part B{n}: Address", f"{req}.address.__oneline__", B, requires=req)

    return {
        "form_id": FORM_ID,
        "municipality": "Ontario (all municipalities except the City of Toronto)",
        "form_title": TITLE,
        "source_pdf": str(OUT.relative_to(ROOT)),
        "pdf_sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
        "created": date.today().isoformat(),
        "mapping_version": 2,
        "fill_strategy": "acroform",
        "layout": "eabo-2008-fillable",
        # consultants are sorted into checkbox order (Architectural first) and
        # unknown-signer consultants show company + address only
        "consultant_blocks": 6,
        "fields": f,
        "unmapped_fields": [],
    }


if __name__ == "__main__":
    n = build_pdf()
    mp = build_mapping()
    MAP.write_text(json.dumps(mp, indent=2))
    print(f"wrote {OUT.relative_to(ROOT)} ({n} fields) and {MAP.relative_to(ROOT)} "
          f"({len(mp['fields'])} entries)")
