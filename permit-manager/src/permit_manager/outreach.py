"""Outreach agent.

Reads the tracker for outstanding signatures and drafts (never sends)
follow-up emails, tailored by recipient role. Drafts are written to
``data/projects/<id>/drafts/`` as JSON; the Gmail draft is created separately
via the Gmail MCP tool after you approve the text.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .schema import ProjectProfile
from .tracker import SignatureRecord, Tracker


@dataclass
class EmailDraft:
    to: str
    subject: str
    body: str
    form_id: str
    party_role: str


def _sender_line(profile: ProjectProfile) -> str:
    who = profile.applicant.name or profile.architect_of_record.name or "the project team"
    firm = profile.applicant.company or profile.architect_of_record.company
    return f"{who}, {firm}".strip(", ")


def draft_for(rec: SignatureRecord, profile: ProjectProfile) -> EmailDraft:
    muni = profile.municipality.name or "the municipality"
    site = profile.property_address.one_line() or profile.project_name
    proj = profile.project_name or site
    sender = _sender_line(profile)
    is_owner = rec.party_role == "owner"
    chased = rec.status == "sent"

    if is_owner:
        subject = f"Signature needed: {rec.form_title} - {proj}"
        opener = (
            f"Hi {rec.recipient_name or 'there'},\n\n"
            f"Following up on the {rec.form_title} for {proj} ({site}), our "
            f"building permit application to {muni}."
        )
        ask = (
            "The form is filled out and ready for your review. Could you please "
            "sign and date Part A (owner) where indicated and return a signed "
            "copy? Everything else is complete - only your signature is "
            "outstanding."
        )
        tone_close = "Happy to walk through any of it if useful."
    else:
        role = rec.party_role.split(":", 1)[-1].replace("_", " ")
        subject = f"General Review commitment - signature needed ({role}) - {proj}"
        opener = (
            f"Hi {rec.recipient_name or 'there'},\n\n"
            f"We're assembling the Owner's Commitment to General Review for "
            f"{proj} ({site}) as part of the permit application to {muni}."
        )
        ask = (
            f"Your Part B block ({role}) is pre-filled with your firm and "
            "contact details. Could you please review, then sign and date your "
            "block and send back a signed copy? Please leave the owner's Part A "
            "as-is."
        )
        tone_close = "Let me know if any of the pre-filled details need correcting."

    if chased:
        opener += "\n\n(Just a gentle nudge on this one - flagging in case it slipped through.)"

    body = (
        f"{opener}\n\n{ask}\n\n{tone_close}\n\n"
        f"Thanks,\n{sender}"
    )
    return EmailDraft(to=rec.recipient_email, subject=subject, body=body,
                      form_id=rec.form_id, party_role=rec.party_role)


def draft_all_outstanding(tracker: Tracker, profile: ProjectProfile,
                          drafts_dir: str | Path) -> list[EmailDraft]:
    drafts_dir = Path(drafts_dir)
    drafts_dir.mkdir(parents=True, exist_ok=True)
    out: list[EmailDraft] = []
    for rec in tracker.outstanding():
        d = draft_for(rec, profile)
        out.append(d)
        fn = drafts_dir / f"{rec.form_id}__{rec.party_role.replace(':', '_')}.json"
        fn.write_text(json.dumps(asdict(d), indent=2))
    return out
