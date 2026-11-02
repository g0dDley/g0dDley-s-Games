"""Core guardrail tests. Run: PYTHONPATH=src python -m pytest tests -q"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from permit_manager import introspect as I
from permit_manager import mapping as M
from permit_manager import fill as F
from permit_manager.schema import (
    ProjectProfile, Party, Consultant, Address, Contact, Municipality, Permit,
)

FORM = ROOT / "forms/blank/ontario_eabo/owner_commitment_general_review.pdf"


def _profile():
    return ProjectProfile(
        project_id="t", project_name="T",
        municipality=Municipality(name="City of Oshawa"),
        property_address=Address(street_address="1 Main St", city="Oshawa"),
        permit=Permit(work_description="work"),
        owner=Party(company="Owner Co", name="Owner Name", email="o@x.com"),
        coordinator=Contact(company="Coord Co", name="Coord Name"),
        consultants=[Consultant(discipline="STRUCTURAL", company="S Co", name="S Name")],
    )


def test_is_protected():
    assert M.is_protected("Signature of applicant", "Signature")
    assert M.is_protected("Date:", "")
    assert M.is_protected("OwnerSignature", "")
    assert not M.is_protected("Owner's Company Name:", "")
    assert not M.is_protected("Municipality:", "")


def test_unauthorized_signature_never_filled(tmp_path):
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    # default profile: no one is signature_authorized
    res = F.fill_overlay(mp, _profile(), tmp_path / "out.pdf", mapping_source="new")

    # no signature is ever placed without authorisation
    assert not any(f.placement == "signature" for f in res.filled)
    # signature/date fields are blank, and only ever for protected/route-out reasons
    sig_blanks = [b for b in res.blank if "Signature" in b.label or b.label.endswith("Date:")
                  or "Date (" in b.label or "Date:" in b.label]
    assert sig_blanks
    for b in sig_blanks:
        assert b.reason in ("protected", "awaiting-signature")


def test_no_signatures_placed_by_default(tmp_path):
    # even an authorised signer with an asset gets NO signature by default -
    # signatures are added manually.
    p = _profile()
    p.consultants[0].signature_authorized = True
    p.consultants[0].signature_asset = "assets/signatures/nick_swerdfeger.png"
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    res = F.fill_overlay(mp, p, tmp_path / "out.pdf")           # default: no sigs
    assert not any(f.placement == "signature" for f in res.filled)
    assert not any(f.target and f.target.endswith("signature_date") for f in res.filled)


def test_authorized_signature_placed_when_explicitly_enabled(tmp_path):
    p = _profile()
    p.consultants[0].signature_authorized = True
    p.consultants[0].signer_known = True
    # real signatures are local-only (never in the repo) - use a throwaway image
    import fitz
    sig = tmp_path / "sig.png"
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 60, 20), False)
    pix.clear_with(255)
    pix.save(str(sig))
    p.consultants[0].signature_asset = str(sig)   # absolute path wins over ROOT /
    p.consultants[0].signature_required = False
    p.consultants.append(Consultant(discipline="MECHANICAL", company="MCW",
                                    name="Paula Terry", signature_required=True))
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    res = F.fill_overlay(mp, p, tmp_path / "out.pdf", apply_signatures=True)

    placed = [f for f in res.filled if f.placement == "signature"]
    assert len(placed) == 1 and p.consultants[0].name in placed[0].value
    assert any(f.target == "consultants.0.signature_date" for f in res.filled)
    # the consultant (block 2) routes out - signature left blank
    b2 = [b for b in res.blank if b.label.startswith("Part B2 Signature")]
    assert b2 and b2[0].reason == "awaiting-signature"


def test_discipline_checkbox_filled(tmp_path):
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    res = F.fill_overlay(mp, _profile(), tmp_path / "out.pdf")
    disc = [f for f in res.filled if "discipline" in f.label]
    assert disc and disc[0].value == "STRUCTURAL"


def test_empty_value_left_blank(tmp_path):
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    res = F.fill_overlay(mp, _profile(), tmp_path / "out.pdf")
    # only one consultant supplied -> block 2..4 mapped-but-empty, never guessed
    assert any(b.reason == "no-value" for b in res.blank)
    filled_targets = {f.target for f in res.filled}
    assert "consultants.1.company" not in filled_targets


def _map():
    intro = I.introspect(FORM)
    return M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                        form_title="EABO")


def test_unknown_signer_shows_company_and_address_only(tmp_path):
    p = ProjectProfile(project_id="t", consultants=[
        Consultant(discipline="MECHANICAL", company="MCW Consultants Ltd.",
                   name="Someone Specific", email="x@mcw.com", phone="416-000-0000",
                   address=Address(street_address="207 Queens Quay", city="Toronto"),
                   signer_known=False)])
    res = F.fill_overlay(_map(), p, tmp_path / "out.pdf")
    filled = {f.target: f.value for f in res.filled}
    assert filled.get("consultants.0.company") == "MCW Consultants Ltd."
    assert "consultants.0.address.__oneline__" in filled          # address shown
    assert any(f.target == "consultants.0.discipline" for f in res.filled)  # box checked
    # person-specific fields are NOT on the form
    assert "consultants.0.name" not in filled
    assert "consultants.0.phone" not in filled
    assert "consultants.0.email" not in filled


def test_known_signer_shows_name(tmp_path):
    p = ProjectProfile(project_id="t", consultants=[
        Consultant(discipline="ARCHITECTURAL", company="BBA", name="Nick Swerdfeger",
                   email="n@bba.com", signer_known=True)])
    res = F.fill_overlay(_map(), p, tmp_path / "out.pdf")
    filled = {f.target: f.value for f in res.filled}
    assert filled.get("consultants.0.name") == "Nick Swerdfeger"
    assert filled.get("consultants.0.email") == "n@bba.com"


def test_blocks_ordered_by_discipline(tmp_path):
    p = ProjectProfile(project_id="t", consultants=[
        Consultant(discipline="ELECTRICAL", company="E"),
        Consultant(discipline="ARCHITECTURAL", company="A"),
        Consultant(discipline="STRUCTURAL", company="S")])
    res = F.fill_overlay(_map(), p, tmp_path / "out.pdf")
    disc = {f.label: f.value for f in res.filled if "discipline" in f.label}
    assert disc["Part B block 1 - discipline"] == "ARCHITECTURAL"
    assert disc["Part B block 2 - discipline"] == "STRUCTURAL"
    assert disc["Part B block 3 - discipline"] == "ELECTRICAL"


def test_empty_address_not_filled(tmp_path):
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    res = F.fill_overlay(mp, _profile(), tmp_path / "out.pdf")
    # owner address is entirely empty -> must be blank, not a stray "ON"
    owner_addr = [f for f in res.filled if f.target == "owner.address.__oneline__"]
    assert not owner_addr


def test_long_value_wraps_and_is_never_truncated(tmp_path):
    p = _profile()
    p.consultants[0].address = Address(
        street_address="123 Wellington Street West, Suite 4000",
        city="Toronto", province_state="ON", postal_code="M5K 1A1")
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    res = F.fill_overlay(mp, p, tmp_path / "out.pdf")

    # nothing anywhere is truncated with an ellipsis
    assert all("…" not in f.value for f in res.filled)
    # the long address overflows its inline slot -> placed on the wrap line
    addr = [f for f in res.filled if f.target == "consultants.0.address.__oneline__"][0]
    assert addr.placement == "wrap-below"
    assert addr.value == p.consultants[0].address.one_line()


# ---- Whitby forms (AcroForm + EABO 08/2008 overlay) ------------------------
import json as _json  # noqa: E402

from permit_manager.forms import fill_form  # noqa: E402
from permit_manager.schema import ProjectProfile  # noqa: E402

_ROOT = Path(__file__).resolve().parents[1]
_STLUKE = _ROOT / "data/projects/25062-st-luke-classroom-addition/profile.json"


def _whitby(name):
    return _json.loads((_ROOT / "mappings" / f"town_of_whitby__{name}.json").read_text())


def test_acroform_ticks_escaped_checkbox_states(tmp_path):
    import fitz
    p = ProjectProfile.load(_STLUKE)
    out = tmp_path / "permit.pdf"
    res = fill_form(_whitby("application_permit_construct_demolish"), p, out)
    assert not [b for b in res.blank if b.reason == "overflow"]
    on = {w.field_name + ":" + w.on_state()
          for pg in fitz.open(out) for w in pg.widgets() or []
          if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX and w.field_value not in ("Off", "", False)}
    assert any("Addition" in s for s in on)          # '#20'-escaped on-state
    # signatures / dates never written
    assert not any("signature" in (f.target or "").lower() for f in res.filled)


def test_eabo2008_five_consultants_two_pages(tmp_path):
    import fitz
    p = ProjectProfile.load(_STLUKE)
    out = tmp_path / "gr.pdf"
    res = fill_form(_whitby("commitment_general_review"), p, out)
    assert fitz.open(out).page_count == 2
    assert not any(f.placement == "signature" for f in res.filled)
