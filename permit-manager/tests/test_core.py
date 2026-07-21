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


def test_signature_and_date_never_filled(tmp_path):
    intro = I.introspect(FORM)
    mp = M.build_eabo_overlay_mapping(intro, municipality="City of Oshawa",
                                      form_title="EABO")
    res = F.fill_overlay(mp, _profile(), tmp_path / "out.pdf", mapping_source="new")

    protected_labels = {b.label for b in res.blank if b.reason == "protected"}
    # every signature / date anchor must be reported blank & protected
    assert any("Signature" in l for l in protected_labels)
    assert any("Date" in l for l in protected_labels)
    # and none of them may appear as a filled field
    for f in res.filled:
        assert "signature" not in f.label.lower()
        assert not f.label.lower().endswith("date:")


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
