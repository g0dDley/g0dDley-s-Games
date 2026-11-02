"""One entry point to fill any cached form, whatever its strategy."""
from __future__ import annotations

import json
from pathlib import Path

from .acroform import fill_acroform_widgets
from .fill import ROOT, FillResult, fill_overlay_paged, render_preview
from .review import assumption_summary
from .schema import ProjectProfile

# Standard Commitment to General Review (EABO, fillable, Part B continued on
# page 2) - the base form for every Ontario project outside the City of Toronto
# unless a project says otherwise. Built by scripts/build_general_review_base.py.
GENERAL_REVIEW_MAPPING = ROOT / "mappings" / "ontario__commitment_general_review.json"


def general_review_mapping(profile: ProjectProfile) -> dict:
    """The Commitment to General Review mapping to use for this project."""
    muni = (profile.municipality.name or "").lower()
    if "toronto" in muni:
        raise ValueError("City of Toronto uses its own general review form - not set up yet; "
                         "provide Toronto's form to map it.")
    return json.loads(GENERAL_REVIEW_MAPPING.read_text())


def _render(pdf: Path, png: Path, page_index: int) -> None:
    """Preview with PDFium when available (shows form fields as Acrobat does;
    MuPDF paints an orange 'SIGN' tab on empty signature fields), else MuPDF."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        render_preview(pdf, png, page_index=page_index)
        return
    doc = pdfium.PdfDocument(str(pdf))
    doc.init_forms()
    doc[page_index].render(scale=150 / 72, may_draw_forms=True).to_pil().save(png)
    doc.close()


def fill_form(mapping: dict, profile: ProjectProfile, out_pdf: str | Path) -> FillResult:
    if mapping.get("fill_strategy") == "acroform":
        return fill_acroform_widgets(mapping, profile, out_pdf)
    return fill_overlay_paged(mapping, profile, out_pdf)


def fill_and_review(mapping: dict, profile: ProjectProfile, out_dir: str | Path) -> dict:
    """Fill, render a preview of every page, and write the assumption summary."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    fid = mapping["form_id"]
    pdf = out_dir / f"{fid}.pdf"
    res = fill_form(mapping, profile, pdf)
    import fitz
    pages = fitz.open(pdf).page_count
    previews = []
    for i in range(pages):
        png = out_dir / f"{fid}.preview{'' if i == 0 else f'-p{i + 1}'}.png"
        _render(pdf, png, i)
        previews.append(png)
    summary = assumption_summary(res, mapping)
    (out_dir / f"{fid}.summary.txt").write_text(summary)
    return {"pdf": pdf, "previews": previews, "summary": summary, "result": res}
