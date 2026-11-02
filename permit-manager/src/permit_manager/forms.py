"""One entry point to fill any cached form, whatever its strategy."""
from __future__ import annotations

from pathlib import Path

from .acroform import fill_acroform_widgets
from .fill import FillResult, fill_overlay_paged, render_preview
from .review import assumption_summary
from .schema import ProjectProfile


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
        render_preview(pdf, png, page_index=i)
        previews.append(png)
    summary = assumption_summary(res, mapping)
    (out_dir / f"{fid}.summary.txt").write_text(summary)
    return {"pdf": pdf, "previews": previews, "summary": summary, "result": res}
