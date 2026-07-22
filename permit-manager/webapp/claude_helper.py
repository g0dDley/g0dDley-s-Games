"""Claude smarts for the dashboard (optional — active only when an
ANTHROPIC_API_KEY is set). Every function degrades gracefully: if there's no
key, callers fall back to the deterministic behaviour.

Design principle mirrors the tool: NEVER guess. Extraction/research return only
what a source supports, with a confidence flag and the evidence, so you review
before anything lands in a form.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

BIG = "claude-opus-4-8"      # accuracy-sensitive: extraction, research
FAST = "claude-sonnet-5"     # writing: email drafts


def available() -> bool:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def _client():
    import anthropic
    return anthropic.Anthropic()


@dataclass
class Suggestion:
    target: str
    label: str
    value: str
    confidence: str          # "high" | "low"
    evidence: str


_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "value": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "low"]},
                    "evidence": {"type": "string"},
                },
                "required": ["target", "value", "confidence", "evidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}


def extract_fields(document_text: str, fields: list[dict], context: str) -> list[Suggestion]:
    """Read a document and propose values for the requested fields.

    `fields` is a list of {target, label}. Returns only fields the document
    actually supports; never invents a value.
    """
    if not fields or not document_text.strip():
        return []
    wanted = "\n".join(f"- {f['target']}  ({f['label']})" for f in fields)
    labels = {f["target"]: f["label"] for f in fields}
    system = (
        "You extract building-permit form values from a source document. "
        "Return a value for a field ONLY if the document clearly states or "
        "unambiguously contains it. Never guess or infer beyond the text. If a "
        "field isn't supported by the document, omit it. Set confidence 'low' "
        "when the match is indirect. 'evidence' must be a short verbatim quote "
        "from the document."
    )
    prompt = (
        f"Project context:\n{context}\n\n"
        f"Fields still needed (target — description):\n{wanted}\n\n"
        f"Document:\n\"\"\"\n{document_text[:120000]}\n\"\"\"\n\n"
        "Return the suggestions."
    )
    resp = _client().messages.create(
        model=BIG, max_tokens=2000,
        thinking={"type": "adaptive"},
        output_config={"format": {"type": "json_schema", "schema": _EXTRACT_SCHEMA}},
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    data = json.loads(text)
    return [
        Suggestion(s["target"], labels.get(s["target"], s["target"]),
                   s["value"], s["confidence"], s["evidence"])
        for s in data.get("suggestions", []) if s.get("value", "").strip()
    ]


def research_property(address: str, municipality: str, fields: list[dict]) -> list[Suggestion]:
    """Use web search to find missing property facts. Free public sources only;
    reports a source URL per value and never guesses."""
    if not fields or not address:
        return []
    wanted = "\n".join(f"- {f['target']}  ({f['label']})" for f in fields)
    labels = {f["target"]: f["label"] for f in fields}
    system = (
        "You research property facts for Ontario building-permit forms using "
        "web search of free public sources (municipal sites, zoning maps, open "
        "data, public listings). Report a value ONLY if a source states it; "
        "never guess. You do not have paid parcel services (GeoWarehouse/MPAC). "
        "End your reply with a single JSON object: "
        '{"suggestions":[{"target","value","confidence","evidence"}]} where '
        "evidence is the source URL. Omit anything you could not verify."
    )
    prompt = (
        f"Property: {address}, {municipality}\n\n"
        f"Find these fields (target — description):\n{wanted}\n\n"
        "Search, then return the JSON object."
    )
    client = _client()
    messages = [{"role": "user", "content": prompt}]
    tools = [{"type": "web_search_20260209", "name": "web_search"}]
    for _ in range(6):  # allow the server-tool loop to resume on pause_turn
        resp = client.messages.create(model=BIG, max_tokens=4000, system=system,
                                      tools=tools, messages=messages)
        if resp.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": resp.content})
            continue
        break
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    start, end = text.rfind("{"), text.rfind("}")
    if start == -1 or end == -1:
        return []
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return []
    return [
        Suggestion(s["target"], labels.get(s["target"], s["target"]),
                   s.get("value", ""), s.get("confidence", "low"), s.get("evidence", ""))
        for s in data.get("suggestions", []) if s.get("value", "").strip()
    ]


_EMAIL_SCHEMA = {
    "type": "object",
    "properties": {"subject": {"type": "string"}, "body": {"type": "string"}},
    "required": ["subject", "body"],
    "additionalProperties": False,
}


def draft_email(*, recipient_name: str, recipient_role: str, project: str, site: str,
                municipality: str, form_title: str, chased: bool,
                style_guide: str, sender: str) -> dict:
    """Draft an outreach email in the user's voice. Returns {subject, body}."""
    system = (
        "You draft a short, professional outreach email requesting a signature "
        "on a building-permit form. Match the provided style guide closely; "
        "adjust only for the specific recipient and context. Never attach or "
        "reference an unsigned form (the sender attaches the signed copy). Do "
        "not invent facts not given."
    )
    role = recipient_role.split(":", 1)[-1].replace("_", " ")
    prompt = (
        f"STYLE GUIDE (write in this voice):\n{style_guide or '(no style guide yet — use a warm, concise, professional tone)'}\n\n"
        f"Context:\n- Form: {form_title}\n- Project: {project}\n- Site: {site}\n"
        f"- Municipality: {municipality}\n- Recipient: {recipient_name or 'there'} "
        f"({'owner' if recipient_role == 'owner' else role + ' consultant'})\n"
        f"- This is {'a follow-up nudge' if chased else 'the first request'}\n"
        f"- Sign off as: {sender}\n\n"
        "Ask them to complete their part, sign, date, and return a signed copy. "
        "Return subject and body."
    )
    resp = _client().messages.create(
        model=FAST, max_tokens=1000,
        output_config={"format": {"type": "json_schema", "schema": _EMAIL_SCHEMA}},
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    return json.loads(text)
