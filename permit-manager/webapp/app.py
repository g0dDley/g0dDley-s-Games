"""Permit Desk - a minimal local dashboard over the permit-manager engine.

Run:  pip install -r ../requirements.txt && python app.py   (then open http://localhost:5000)

Tracks multiple permit applications, fills the EABO Owner Commitment form,
shows per-form / per-signer status, and lets you upload signed copies and
re-fill as new information arrives. No API key required.
"""
from __future__ import annotations

import io
import json
import re
import sys
from datetime import date, datetime
from email.message import EmailMessage
from pathlib import Path

import fitz  # PyMuPDF, for reading uploaded documents
from flask import (Flask, abort, redirect, render_template, request,
                   send_file, url_for)

ROOT = Path(__file__).resolve().parents[1]          # permit-manager/
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # for claude_helper

from permit_manager import forms as FORMS            # noqa: E402
from permit_manager.unlock import unlock_form        # noqa: E402
from permit_manager.schema import ProjectProfile, resolve_path  # noqa: E402
from permit_manager.tracker import STATUSES, SignatureRecord, Tracker  # noqa: E402
from permit_manager import outreach as O             # noqa: E402
import claude_helper as ai                           # noqa: E402

STYLE_PATH = ROOT / "data" / "email_style.md"       # your email voice (global)

# Property facts the researcher / extractor can try to find.
RESEARCH_FIELDS = [
    {"target": "municipality.name", "label": "Municipality"},
    {"target": "property_address.postal_code", "label": "Postal code"},
    {"target": "legal_description.lot", "label": "Lot"},
    {"target": "legal_description.registered_plan", "label": "Registered plan"},
    {"target": "legal_description.concession", "label": "Concession"},
    {"target": "legal_description.part", "label": "Part"},
    {"target": "legal_description.roll_number", "label": "Assessment roll number"},
    {"target": "permit.current_use", "label": "Current use / zoning"},
]

PROJECTS = ROOT / "data" / "projects"
MAPPINGS = ROOT / "mappings"
# Standard Ontario Commitment to General Review (fillable EABO base form, Part B
# continued on page 2) - used for every project outside the City of Toronto.
EABO_TITLE = "Commitment to General Review by Architect and Engineer"

app = Flask(__name__)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "project"


def project_dir(pid: str) -> Path:
    d = PROJECTS / pid
    if not (d / "profile.json").exists():
        abort(404)
    return d


def load_profile(pid: str) -> ProjectProfile:
    return ProjectProfile.load(project_dir(pid) / "profile.json")


def tracker_for(pid: str) -> Tracker:
    return Tracker(project_dir(pid) / "tracker.json")


def eabo_form_id(muni: str) -> str:
    return FORMS.GENERAL_REVIEW_MAPPING.stem      # same base form everywhere but Toronto


def set_path(d: dict, dotted: str, value):
    """Set a nested value by dotted path (creating dicts / list slots)."""
    parts = dotted.split(".")
    node = d
    for i, p in enumerate(parts[:-1]):
        nxt_is_idx = parts[i + 1].isdigit()
        if p.isdigit():
            idx = int(p)
            while len(node) <= idx:
                node.append({})
            node = node[idx]
        else:
            if not isinstance(node.get(p), (dict, list)):
                node[p] = [] if nxt_is_idx else {}
            node = node[p]
    last = parts[-1]
    if last.isdigit():
        idx = int(last)
        while len(node) <= idx:
            node.append(None)
        node[idx] = value
    else:
        node[last] = value


def seed_tracker(pid: str, profile: ProjectProfile, fid: str) -> None:
    tr = tracker_for(pid)
    if profile.owner.signature_required and profile.owner.name:
        tr.upsert(SignatureRecord(fid, EABO_TITLE, "owner",
                                  profile.owner.name, profile.owner.email))
    for c in profile.consultants:
        role = f"consultant:{c.discipline.lower().replace(' ', '_')}"
        tr.upsert(SignatureRecord(fid, EABO_TITLE, role, c.name, c.email))
    tr.save()


def form_status(pid: str, fid: str) -> dict:
    """Aggregate a form's signer records into a headline status."""
    recs = [r for r in tracker_for(pid).records if r.form_id == fid]
    signed = sum(1 for r in recs if r.status in ("signed", "received"))
    total = len(recs)
    filled = (project_dir(pid) / "filled" / f"{fid}.pdf").exists()
    if total and signed == total:
        label = "complete"
    elif signed:
        label = "partially signed"
    elif filled:
        label = "filled"
    else:
        label = "not started"
    return {"label": label, "signed": signed, "total": total, "filled": filled}


def project_summary(pid: str) -> dict:
    p = load_profile(pid)
    fid = eabo_form_id(p.municipality.name)
    st = form_status(pid, fid)
    mtime = max((f.stat().st_mtime for f in project_dir(pid).rglob("*") if f.is_file()),
                default=0)
    return {
        "id": pid, "name": p.project_name or pid,
        "municipality": p.municipality.name,
        "address": p.property_address.one_line(),
        "status": st,
        "updated": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M") if mtime else "",
    }


def list_projects() -> list[dict]:
    if not PROJECTS.exists():
        return []
    out = []
    for d in sorted(PROJECTS.iterdir()):
        if (d / "profile.json").exists():
            out.append(project_summary(d.name))
    return out


def make_eml(to: str, subject: str, body: str) -> bytes:
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg["X-Unsent"] = "1"
    msg.set_content(body)
    return bytes(msg)


def style_guide() -> str:
    return STYLE_PATH.read_text() if STYLE_PATH.exists() else ""


def _empty(profile: ProjectProfile, target: str) -> bool:
    v = resolve_path(profile, target)
    return v is None or (isinstance(v, str) and not v.strip())


def missing_fields(pid: str) -> list[dict]:
    """Fields worth trying to fill: the last fill's blanks plus any empty
    researchable property fields, deduped."""
    p = load_profile(pid)
    fid = eabo_form_id(p.municipality.name)
    seen, out = set(), []
    bf = project_dir(pid) / "filled" / f"{fid}.blanks.json"
    if bf.exists():
        for b in json.loads(bf.read_text()):
            if b["target"] not in seen:
                seen.add(b["target"]); out.append(b)
    for f in RESEARCH_FIELDS:
        if f["target"] not in seen and _empty(p, f["target"]):
            seen.add(f["target"]); out.append(f)
    return out


def docs_dir(pid: str) -> Path:
    return project_dir(pid) / "documents"


def list_docs(pid: str) -> list[str]:
    d = docs_dir(pid)
    return sorted(f.name for f in d.glob("*")) if d.exists() else []


def document_text(pid: str) -> str:
    parts = []
    for f in docs_dir(pid).glob("*") if docs_dir(pid).exists() else []:
        try:
            if f.suffix.lower() == ".pdf":
                doc = fitz.open(f)
                parts.append(f"### {f.name}\n" + "\n".join(pg.get_text() for pg in doc))
            elif f.suffix.lower() in (".txt", ".md", ".csv"):
                parts.append(f"### {f.name}\n" + f.read_text(errors="ignore"))
        except Exception:  # noqa: BLE001 - skip unreadable files
            continue
    return "\n\n".join(parts)


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------
@app.route("/")
def dashboard():
    return render_template("dashboard.html", projects=list_projects())


@app.post("/projects")
def create_project():
    name = request.form.get("name", "").strip()
    muni = request.form.get("municipality", "").strip()
    if not name:
        return redirect(url_for("dashboard"))
    pid = f"{date.today():%Y}-{slugify(name)}"
    d = PROJECTS / pid
    d.mkdir(parents=True, exist_ok=True)
    if not (d / "profile.json").exists():
        ProjectProfile(project_id=pid, project_name=name,
                       municipality={"name": muni}).save(d / "profile.json")
    return redirect(url_for("project", pid=pid))


@app.route("/projects/<pid>")
def project(pid: str):
    p = load_profile(pid)
    fid = eabo_form_id(p.municipality.name)
    fdir = project_dir(pid) / "filled"
    summary = (fdir / f"{fid}.summary.txt")
    blanks_file = fdir / f"{fid}.blanks.json"
    blanks = json.loads(blanks_file.read_text()) if blanks_file.exists() else []
    signed = sorted((project_dir(pid) / "signed").glob("*.pdf")) \
        if (project_dir(pid) / "signed").exists() else []
    return render_template(
        "project.html", p=p, pid=pid, fid=fid,
        status=form_status(pid, fid),
        has_filled=(fdir / f"{fid}.pdf").exists(),
        has_preview=(fdir / f"{fid}.preview.png").exists(),
        summary=summary.read_text() if summary.exists() else "",
        blanks=blanks,
        records=[r for r in tracker_for(pid).records if r.form_id == fid],
        statuses=STATUSES,
        signed_files=[f.name for f in signed],
        profile_json=json.dumps(p.model_dump(), indent=2),
        ai_on=ai.available(), docs=list_docs(pid), missing=missing_fields(pid),
    )


@app.post("/projects/<pid>/fill")
def fill(pid: str):
    p = load_profile(pid)
    fid = eabo_form_id(p.municipality.name)
    try:
        mp = FORMS.general_review_mapping(p)
    except ValueError as e:                       # e.g. City of Toronto
        return str(e), 400
    fdir = project_dir(pid) / "filled"
    res = FORMS.fill_and_review(mp, p, fdir)["result"]   # pdf, previews, summary
    # persist the fields left blank for manual entry, for the inline editor
    # simple scalar gaps only (skip composite/computed targets like *.__oneline__)
    blanks = [{"label": b.label, "target": b.target}
              for b in res.blank
              if b.reason == "no-value" and b.target and "__" not in b.target]
    (fdir / f"{fid}.blanks.json").write_text(json.dumps(blanks, indent=2))
    seed_tracker(pid, p, fid)
    return redirect(url_for("project", pid=pid) + "#forms")


@app.post("/projects/<pid>/fields")
def update_fields(pid: str):
    """Save the inline 'missing info' inputs back into the profile."""
    d = load_profile(pid).model_dump()
    for key, value in request.form.items():
        if key.startswith("field:") and value.strip():
            set_path(d, key[len("field:"):], value.strip())
    ProjectProfile.model_validate(d).save(project_dir(pid) / "profile.json")
    return redirect(url_for("project", pid=pid))


@app.post("/projects/<pid>/profile")
def update_profile(pid: str):
    try:
        d = json.loads(request.form["profile_json"])
        ProjectProfile.model_validate(d).save(project_dir(pid) / "profile.json")
    except Exception as e:  # noqa: BLE001 - surface validation errors simply
        return f"Invalid profile: {e}", 400
    return redirect(url_for("project", pid=pid))


@app.post("/projects/<pid>/track")
def track(pid: str):
    tr = tracker_for(pid)
    tr.set_status(request.form["form_id"], request.form["role"], request.form["status"])
    tr.save()
    return redirect(url_for("project", pid=pid) + "#tracker")


@app.post("/projects/<pid>/upload-signed")
def upload_signed(pid: str):
    file = request.files.get("file")
    if not file or not file.filename:
        return redirect(url_for("project", pid=pid))
    sdir = project_dir(pid) / "signed"
    sdir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    saved = sdir / f"{stamp}__{Path(file.filename).name}"
    file.save(saved)
    # Acrobat's Fill & Sign makes every field read-only when a signature is
    # saved - clear that so the form can keep being filled / re-signed.
    # (Certificate-signed files are left untouched.)
    if saved.suffix.lower() == ".pdf":
        try:
            unlock_form(saved)
        except Exception:  # noqa: BLE001 - keep the upload even if unlocking fails
            pass
    # mark any roles the user checked as signed
    tr = tracker_for(pid)
    for role in request.form.getlist("signed_roles"):
        try:
            tr.set_status(request.form["form_id"], role, "signed")
        except KeyError:
            pass
    tr.save()
    return redirect(url_for("project", pid=pid) + "#tracker")


@app.route("/projects/<pid>/preview.png")
def preview(pid: str):
    p = load_profile(pid)
    fid = eabo_form_id(p.municipality.name)
    f = project_dir(pid) / "filled" / f"{fid}.preview.png"
    if not f.exists():
        abort(404)
    return send_file(f, mimetype="image/png")


@app.route("/projects/<pid>/filled.pdf")
def filled_pdf(pid: str):
    p = load_profile(pid)
    fid = eabo_form_id(p.municipality.name)
    f = project_dir(pid) / "filled" / f"{fid}.pdf"
    if not f.exists():
        abort(404)
    return send_file(f, mimetype="application/pdf",
                     download_name=f"{fid}.pdf")


@app.route("/projects/<pid>/signed/<name>")
def signed_file(pid: str, name: str):
    f = project_dir(pid) / "signed" / Path(name).name
    if not f.exists():
        abort(404)
    return send_file(f, mimetype="application/pdf", download_name=Path(name).name)


# ---- Claude smarts (active only when ANTHROPIC_API_KEY is set) -----------
@app.post("/projects/<pid>/documents")
def upload_document(pid: str):
    file = request.files.get("file")
    if file and file.filename:
        docs_dir(pid).mkdir(exist_ok=True)
        file.save(docs_dir(pid) / Path(file.filename).name)
    return redirect(url_for("project", pid=pid) + "#docs")


@app.post("/projects/<pid>/extract")
def extract(pid: str):
    if not ai.available():
        return "Set ANTHROPIC_API_KEY to enable Claude features.", 400
    p = load_profile(pid)
    text = document_text(pid)
    if not text.strip():
        return redirect(url_for("project", pid=pid) + "#docs")
    ctx = f"{p.project_name} — {p.property_address.one_line()} — {p.municipality.name}"
    try:
        sugg = ai.extract_fields(text, missing_fields(pid), ctx)
    except Exception as e:  # noqa: BLE001
        return f"Claude extraction failed: {e}", 502
    return render_template("suggestions.html", pid=pid, p=p, suggestions=sugg,
                           source="uploaded documents")


@app.post("/projects/<pid>/research")
def research(pid: str):
    if not ai.available():
        return "Set ANTHROPIC_API_KEY to enable Claude features.", 400
    p = load_profile(pid)
    fields = [f for f in RESEARCH_FIELDS if _empty(p, f["target"])]
    try:
        sugg = ai.research_property(p.property_address.one_line(),
                                    p.municipality.name, fields)
    except Exception as e:  # noqa: BLE001
        return f"Claude research failed: {e}", 502
    return render_template("suggestions.html", pid=pid, p=p, suggestions=sugg,
                           source="online research")


@app.post("/projects/<pid>/apply-suggestions")
def apply_suggestions(pid: str):
    d = load_profile(pid).model_dump()
    for target in request.form.getlist("accept"):
        val = request.form.get(f"value:{target}", "").strip()
        if val:
            set_path(d, target, val)
    ProjectProfile.model_validate(d).save(project_dir(pid) / "profile.json")
    return redirect(url_for("project", pid=pid))


@app.post("/style")
def save_style():
    STYLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STYLE_PATH.write_text(request.form.get("style", ""))
    return redirect(request.form.get("next", url_for("dashboard")))


@app.route("/projects/<pid>/outreach")
def outreach(pid: str):
    p = load_profile(pid)
    tr = tracker_for(pid)
    drafts = []
    for rec in tr.outstanding():
        if ai.available():
            try:
                d = ai.draft_email(
                    recipient_name=rec.recipient_name, recipient_role=rec.party_role,
                    project=p.project_name, site=p.property_address.one_line(),
                    municipality=p.municipality.name, form_title=rec.form_title,
                    chased=(rec.status == "sent"), style_guide=style_guide(),
                    sender=(p.applicant.name + ", " + p.applicant.company).strip(", "))
                drafts.append({"to": rec.recipient_email, "subject": d["subject"],
                               "body": d["body"], "role": rec.party_role})
                continue
            except Exception:  # noqa: BLE001 - fall back to deterministic
                pass
        det = O.draft_for(rec, p)
        drafts.append({"to": det.to, "subject": det.subject, "body": det.body,
                       "role": rec.party_role})
    return render_template("outreach.html", pid=pid, p=p, drafts=drafts,
                           ai_on=ai.available(), style=style_guide())


@app.route("/projects/<pid>/outreach/<role>.eml", methods=["POST"])
def outreach_eml(pid: str, role: str):
    data = make_eml(request.form.get("to", ""), request.form.get("subject", ""),
                    request.form.get("body", ""))
    return send_file(io.BytesIO(data), mimetype="message/rfc822", as_attachment=True,
                     download_name=f"{pid}-{role.replace(':', '_')}.eml")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
