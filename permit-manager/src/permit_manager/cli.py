"""Command-line entry points.

    python -m permit_manager introspect FORM.pdf
    python -m permit_manager map-eabo FORM.pdf --municipality "City of Oshawa"
    python -m permit_manager fill --project PROJECT_ID --form FORM_ID
    python -m permit_manager track  --project PROJECT_ID [--set form/role=status]
    python -m permit_manager outreach --project PROJECT_ID
"""
from __future__ import annotations

import argparse
from pathlib import Path

from . import introspect as I
from . import mapping as M
from . import fill as F
from . import outreach as O
from .review import assumption_summary
from .schema import ProjectProfile
from .tracker import SignatureRecord, Tracker

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "mappings"
PROJECTS = ROOT / "data" / "projects"


def _project_dir(pid: str) -> Path:
    return PROJECTS / pid


def cmd_introspect(a):
    intro = I.introspect(a.pdf)
    print(f"{Path(a.pdf).name}: {intro.page_count} pages, "
          f"{'AcroForm' if intro.has_form_fields else 'FLAT (overlay)'}, "
          f"{len(intro.fields)} fields, sha256={intro.sha256[:12]}")
    for f in intro.fields:
        prot = " [PROTECTED]" if M.is_protected(f.name, f.type) else ""
        print(f"  p{f.page} {f.type:<10} {f.name!r}{prot}")


def cmd_map_eabo(a):
    intro = I.introspect(a.pdf)
    mp = M.build_eabo_overlay_mapping(
        intro, municipality=a.municipality,
        form_title="Owner Commitment to Have General Review Undertaken")
    out = M.cache_path(MAPPINGS, mp["form_id"])
    M.save_mapping(out, mp)
    print(f"wrote {out}  ({len(mp['fields'])} anchors, "
          f"{len(mp['unmapped_fields'])} unmatched)")


def cmd_fill(a):
    mp = M.load_mapping(M.cache_path(MAPPINGS, a.form))
    profile = ProjectProfile.load(_project_dir(a.project) / "profile.json")

    intro = I.introspect(mp["source_pdf"])
    if M.is_stale(mp, intro):
        print("WARNING: blank form changed since mapping was cached - re-run map-eabo.")

    out_pdf = _project_dir(a.project) / "filled" / f"{a.form}.pdf"
    if mp["fill_strategy"] == "overlay":
        res = F.fill_overlay(mp, profile, out_pdf, mapping_source="cached",
                             fill_low_confidence=a.approve_low)
        png = _project_dir(a.project) / "filled" / f"{a.form}.preview.png"
        F.render_preview(out_pdf, png)
        print(assumption_summary(res, mp))
        print(f"\nPreview   : {png}")
    else:
        res = F.fill_acroform(mp, profile, out_pdf, mapping_source="cached")
        print(assumption_summary(res, mp))


def cmd_track(a):
    tr = Tracker(_project_dir(a.project) / "tracker.json")
    if a.init:
        profile = ProjectProfile.load(_project_dir(a.project) / "profile.json")
        mp = M.load_mapping(M.cache_path(MAPPINGS, a.init))
        fid, title = mp["form_id"], mp["form_title"]
        if profile.owner.signature_required and profile.owner.name:
            tr.upsert(SignatureRecord(fid, title, "owner",
                                      profile.owner.name, profile.owner.email))
        for c in profile.consultants:
            role = f"consultant:{c.discipline.lower().replace(' ', '_')}"
            # All signatures are applied manually now, so every block starts
            # "drafted" (awaiting a signature) - nothing is auto-marked signed.
            tr.upsert(SignatureRecord(fid, title, role, c.name, c.email))
        tr.save()
        print(f"seeded {len(tr.records)} record(s) for {fid}")
    if a.set:
        ref, status = a.set.split("=")
        form_id, role = ref.split("/", 1)
        tr.set_status(form_id, role, status)
        tr.save()
        print(f"set {form_id}/{role} -> {status}")
    for r in tr.records:
        wait = "" if r.status in ("signed", "received") else "  <-- waiting"
        print(f"  {r.status:<9} {r.party_role:<22} {r.recipient_name:<20} "
              f"{r.form_title}{wait}")


def cmd_outreach(a):
    profile = ProjectProfile.load(_project_dir(a.project) / "profile.json")
    tr = Tracker(_project_dir(a.project) / "tracker.json")
    drafts = O.draft_all_outstanding(tr, profile, _project_dir(a.project) / "drafts")
    for d in drafts:
        print("-" * 60)
        print(f"To: {d.to or '(no email on file)'}\nSubject: {d.subject}\n")
        print(d.body)
    print("-" * 60)
    print(f"\n{len(drafts)} draft(s) written to {_project_dir(a.project)/'drafts'} "
          "(not sent).")


def main(argv=None):
    p = argparse.ArgumentParser(prog="permit_manager")
    sub = p.add_subparsers(required=True)

    s = sub.add_parser("introspect"); s.add_argument("pdf"); s.set_defaults(fn=cmd_introspect)

    s = sub.add_parser("map-eabo"); s.add_argument("pdf")
    s.add_argument("--municipality", required=True); s.set_defaults(fn=cmd_map_eabo)

    s = sub.add_parser("fill"); s.add_argument("--project", required=True)
    s.add_argument("--form", required=True)
    s.add_argument("--approve-low", action="store_true",
                   help="also write low-confidence mappings")
    s.set_defaults(fn=cmd_fill)

    s = sub.add_parser("track"); s.add_argument("--project", required=True)
    s.add_argument("--init", help="seed records from profile for FORM_ID")
    s.add_argument("--set", help="FORM_ID/role=status")
    s.set_defaults(fn=cmd_track)

    s = sub.add_parser("outreach"); s.add_argument("--project", required=True)
    s.set_defaults(fn=cmd_outreach)

    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
