"""Assumption summary - the human review gate before anything is finalised."""
from __future__ import annotations

from .fill import FillResult

_REASON_LABEL = {
    "protected": "signature/date - never filled",
    "awaiting-signature": "left blank for the signer - routes out to them",
    "unmapped": "no confident mapping",
    "no-value": "needs manual entry or an attachment (no value on file)",
    "low-confidence-skipped": "low-confidence mapping - needs your OK",
}


def assumption_summary(res: FillResult, mapping: dict) -> str:
    lines: list[str] = []
    src = "newly built" if res.mapping_source == "new" else "reused from cache"
    lines.append(f"ASSUMPTION SUMMARY - review before finalising")
    lines.append("=" * 60)
    lines.append(f"Form      : {mapping.get('form_title')} ({mapping.get('municipality')})")
    lines.append(f"Strategy  : {mapping.get('fill_strategy')}")
    lines.append(f"Mapping   : {src}  (cache {mapping.get('form_id')}.json)")
    c = res.summary_counts()
    lines.append(f"Result    : {c['filled']} filled, {c['left_blank']} blank, "
                 f"{c['low_confidence']} low-confidence")
    lines.append(f"Output    : {res.output_pdf}")
    lines.append("")

    lines.append(f"FILLED ({len(res.filled)}):")
    for f in res.filled:
        tag = ""
        if f.placement == "wrap-below":
            tag = "  [wrapped below label]"
        elif f.placement == "signature":
            tag = "  [AUTHORISED SIGNATURE - confirm permission + date]"
        lines.append(f"  + {f.label:<34} <- {f.target:<28} = {f.value!r}{tag}")

    if res.low_confidence:
        lines.append("")
        lines.append(f"LOW CONFIDENCE - not written unless you approve ({len(res.low_confidence)}):")
        for f in res.low_confidence:
            lines.append(f"  ? {f.label:<34} <- {f.target:<28} = {f.value!r}")

    lines.append("")
    lines.append(f"LEFT BLANK ({len(res.blank)}):")
    # group by reason for readability
    by_reason: dict[str, list] = {}
    for b in res.blank:
        by_reason.setdefault(b.reason, []).append(b)
    for reason, items in by_reason.items():
        lines.append(f"  [{_REASON_LABEL.get(reason, reason)}]")
        for b in items:
            tail = f"  ({b.target})" if b.target else ""
            lines.append(f"      - {b.label}{tail}")

    unmapped = mapping.get("unmapped_fields") or []
    if unmapped:
        lines.append("")
        lines.append(f"UNMAPPED ANCHORS IN CACHE ({len(unmapped)}):")
        for u in unmapped:
            lines.append(f"      - {u}")

    lines.append("")
    lines.append("Nothing is finalised, sent, or tracked-as-sent until you approve.")
    return "\n".join(lines)
