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


def test_general_review_base_form_is_fillable_with_continuation_page(tmp_path):
    import fitz
    from permit_manager.forms import general_review_mapping
    p = ProjectProfile.load(_STLUKE)
    mp = general_review_mapping(p)
    out = tmp_path / "gr.pdf"
    res = fill_form(mp, p, out)
    doc = fitz.open(out)
    assert doc.page_count == 2
    w = {x.field_name: x for pg in doc for x in pg.widgets()}
    assert len(w) == 93                                   # still a live form
    # page 2 = Part B continued: header + blocks 5-6 only, no Part A
    assert "PART B \u2013 CONTINUED" in doc[1].get_text()
    assert "PART A" not in doc[1].get_text() and "Owner" not in doc[1].get_text()
    # consultants in checkbox order; block 5 (site services) on page 2
    assert w["B1_Architectural"].field_value not in ("Off", False)
    assert w["B5_SiteServices"].field_value not in ("Off", False)
    assert w["B5_ConsultantName"].field_value.startswith("Monument")
    # unknown signer -> company + address only
    assert w["B3_PrintName"].field_value in ("", None)
    # signatures and dates never written; unused block 6 not reported
    assert not w["B1_Signature"].field_value and not w["A_OwnerDate"].field_value
    assert not any(b.label.startswith("Part B6") for b in res.blank)
    # chosen font size is stored on the field so every viewer agrees
    assert w["A_OwnerName"].text_fontsize == 9


def test_general_review_not_used_for_toronto():
    import pytest
    from permit_manager.forms import general_review_mapping
    p = ProjectProfile.load(_STLUKE)
    p.municipality.name = "City of Toronto"
    with pytest.raises(ValueError):
        general_review_mapping(p)


def test_general_review_base_form_has_no_hidden_pieces():
    """Every visible character sits exactly where the original form has it;
    no invisible text, blank glyphs, white cover boxes or form XObjects."""
    import fitz
    src = fitz.open(_ROOT / "forms/blank/ontario/source/eabo_commitment_general_review_2008_flat.pdf")[0]
    base = fitz.open(_ROOT / "forms/blank/ontario/commitment_general_review_eabo_fillable.pdf")
    for pg in base:
        for w in list(pg.widgets()):
            pg.delete_widget(w)
    base = fitz.open("pdf", base.tobytes())

    def vis(page):
        return [(chr(c[0]), round(c[2][0], 2), round(c[2][1], 2), t["font"], round(t["size"], 2))
                for t in page.get_texttrace() if t["type"] != 3 and t["font"] != "Symbol"
                for c in t["chars"]]

    assert vis(base[0]) == vis(src)
    for pg in base:
        assert not [t for t in pg.get_texttrace() if t["type"] == 3 or t["font"] == "Symbol"]
        assert not [d for d in pg.get_drawings() if d.get("fill") == (1.0, 1.0, 1.0)]
        assert not pg.get_xobjects() and not pg.get_images()


def test_carry_over_keeps_entries_and_placed_images(tmp_path):
    import fitz
    from permit_manager.carryover import carry_over
    from permit_manager.forms import general_review_mapping
    p = ProjectProfile.load(_STLUKE)
    mp = general_review_mapping(p)
    old, new = tmp_path / "old.pdf", tmp_path / "new.pdf"
    fill_form(mp, p, old)
    doc = fitz.open(old)
    for w in doc[0].widgets():
        if w.field_name in ("B1_PrintName", "A_OwnerDate"):
            w.field_value = "Someone Else" if w.field_name == "B1_PrintName" else "2026-11-02"
            w.text_fontsize = 0
            w.update()
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 12), False)
    pix.clear_with(200)
    doc[0].insert_image(fitz.Rect(278, 452, 350, 474), stream=pix.tobytes("png"))
    doc.save(tmp_path / "edited.pdf")
    fill_form(mp, p, new)
    res = carry_over(tmp_path / "edited.pdf", new, tmp_path / "out.pdf", mp)
    out = fitz.open(tmp_path / "out.pdf")
    w = {x.field_name: x for pg in out for x in pg.widgets()}
    assert w["B1_PrintName"].field_value == "Someone Else"
    assert w["A_OwnerDate"].field_value == "2026-11-02" and w["A_OwnerDate"].text_fontsize == 9
    assert len(res.images) == 1 and len(out[0].get_images()) == 1


def test_unlock_clears_fill_and_sign_read_only(tmp_path):
    import fitz
    from permit_manager.forms import general_review_mapping
    from permit_manager.unlock import unlock_form
    p = ProjectProfile.load(_STLUKE)
    pdf = tmp_path / "gr.pdf"
    fill_form(general_review_mapping(p), p, pdf)
    doc = fitz.open(pdf)                      # simulate Acrobat Fill & Sign locking
    for pg in doc:
        for w in pg.widgets():
            doc.xref_set_key(w.xref, "Ff", str(int(doc.xref_get_key(w.xref, "Ff")[1] or 0) | 1))
    doc.xref_set_key(doc.pdf_catalog(), "ADBE_FillSignInfo", "<</Version 100>>")
    before = {w.field_name: w.field_value for pg in doc for w in pg.widgets()}
    doc.save(tmp_path / "locked.pdf")
    r = unlock_form(tmp_path / "locked.pdf", tmp_path / "open.pdf")
    assert r.unlocked == 93 and r.fill_sign_marker and not r.digitally_signed
    out = fitz.open(tmp_path / "open.pdf")
    assert not any(w.field_flags & 1 for pg in out for w in pg.widgets())
    assert {w.field_name: w.field_value for pg in out for w in pg.widgets()} == before
    assert "ADBE_FillSignInfo" not in out.xref_object(out.pdf_catalog())
