"""Build the field-mapping cache for the Town of Whitby permit forms (2026).

This is the mapping step for these forms: each AcroForm field is mapped to a
project-profile path (or a condition for checkboxes) by reading the form's
labels. Fields that are municipal-office-use or not applicable are left
unmapped on purpose and listed in `unmapped_fields`.

Run:  PYTHONPATH=src python scripts/build_whitby_mappings.py
"""
from __future__ import annotations

import sys
import warnings
from datetime import date
from pathlib import Path

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import fitz  # noqa: E402
from permit_manager import introspect as I, mapping as M  # noqa: E402

BLANK = ROOT / "forms" / "blank" / "whitby"
MUNI = "Town of Whitby"


def on_states(pdf: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for page in fitz.open(pdf):
        for w in page.widgets() or []:
            if w.field_type_string in ("CheckBox", "RadioButton"):
                out.setdefault(w.field_name, []).append(w.on_state())
    return out


def pick(states: dict, field: str, prefix: str) -> str:
    for s in states[field]:
        if s.startswith(prefix):
            return s
    raise KeyError(f"{field}: no on-state starting {prefix!r} in {states[field]}")


def T(field, label, target):            # text from profile
    return {"pdf_field": field, "label": label, "target": target, "confidence": "high"}


def C(field, label, on, target, op, value, group):   # conditional checkbox
    return {"pdf_field": field, "label": label, "on": on, "group_label": group,
            "when": {"target": target, op: value}, "confidence": "high"}


def P(field, label):                    # protected (signature / signature date)
    return {"pdf_field": field, "label": label, "protected": True, "confidence": "n/a"}


def save(slug: str, title: str, pdf: Path, fields: list, unmapped: list):
    intro = I.introspect(pdf)
    mp = {"form_id": M.form_id(M._slug(MUNI), slug), "municipality": MUNI, "form_title": title,
          "source_pdf": str(pdf), "pdf_sha256": intro.sha256, "created": date.today().isoformat(),
          "mapping_version": M.MAPPING_VERSION, "fill_strategy": "acroform",
          "fields": fields, "unmapped_fields": unmapped}
    path = M.cache_path(ROOT / "mappings", mp["form_id"])
    M.save_mapping(path, mp)
    print(f"wrote {path.name}: {len(fields)} mapped, {len(unmapped)} intentionally unmapped")


# ---------------------------------------------------------------- owner auth
pdf = BLANK / "owner_authorization.pdf"
st = on_states(pdf)
q = "Is written authorization attached"
save("owner_authorization", "Owner's Authorization", pdf, [
    C(q, "Written authorization attached: Yes", pick(st, q, "Yes"),
      "owner_authorization_attached", "equals", True, "Is written authorization attached?"),
    C(q, "Written authorization attached: No", pick(st, q, "No"),
      "owner_authorization_attached", "equals", False, "Is written authorization attached?"),
    T("Owner", "I, ___ am the owner of the land", "owner.company"),
    T("Representative", "I authorize ___ to prepare and submit", "applicant.company"),
    T("Address", "Property Address", "property_address.__oneline__"),
    T("Email", "Owner's Email", "owner.email"),
    T("Phone Number", "Owner's Telephone Number", "owner.phone"),
    P("Signature", "Owner's Signature"),
    P("Date", "Date (owner signature)"),
], [])

# ---------------------------------------------------- permit application
pdf = BLANK / "application_permit_construct_demolish_2026-02.pdf"
st = on_states(pdf)
pur, app = "Purpose of application", "Applicant is"
nh = "Is proposed construction for a new home as defined in the Ontario New Home Warranties Plan Act?"
reg = "Is registration required under the Ontario New Home Warranties Plan Act?"
decl = "Declaration of Designer"
f1 = [n for n in st if n.startswith("This application meets all")][0]
f3 = [n for n in st if n.startswith("This application is accompanied by the plans")][0]
fields = [
    T("Application submitted to ((Name of municipality, upper-tier municipality, board of health or conservation authority)",
      "Application submitted to", "permit.application_submitted_to"),
    # A. project information
    T("Project building number street name", "A. Project street address", "property_address.street_address"),
    T("Project Lot/Concession", "A. Project lot/concession", "legal_description.lot"),
    T("Project Municipality", "A. Project municipality", "property_address.city"),
    T("Project postal code", "A. Project postal code", "property_address.postal_code"),
    T("Project plan number/other description", "A. Project plan number / other description", "legal_description.registered_plan"),
    T("Project value estimated (in dollars)", "A. Project value estimated ($)", "permit.value_estimate"),
    T("Project area of work (in square metres)", "A. Area of work (m2)", "permit.area_sq_m"),
    C(pur, "Purpose: New construction", pick(st, pur, "New"), "permit.purpose", "contains", "New construction", "Purpose of application"),
    C(pur, "Purpose: Addition to an existing building", pick(st, pur, "Addition"), "permit.purpose", "contains", "Addition", "Purpose of application"),
    C(pur, "Purpose: Alteration/repair", pick(st, pur, "Alteration"), "permit.purpose", "contains", "Alteration/Repair", "Purpose of application"),
    C(pur, "Purpose: Demolition", pick(st, pur, "Demolition"), "permit.purpose", "contains", "Demolition", "Purpose of application"),
    C(pur, "Purpose: Conditional permit", pick(st, pur, "Cond"), "permit.purpose", "contains", "Conditional", "Purpose of application"),
    T("Proposed use of building", "A. Proposed use of building", "permit.proposed_use"),
    T("Current use of building", "A. Current use of building", "permit.current_use"),
    T("Description of proposed work", "A. Description of proposed work", "permit.work_description"),
    # B. applicant
    C(app, "Applicant is: Owner", pick(st, app, "Owner"), "permit.applicant_role", "equals", "owner", "Applicant is"),
    C(app, "Applicant is: Authorized agent of owner", pick(st, app, "Authorized"), "permit.applicant_role", "equals", "agent", "Applicant is"),
    T("Applicant last name", "B. Applicant last name", "applicant.name.__last__"),
    T("Applicant First name", "B. Applicant first name", "applicant.name.__first__"),
    T("Applicant Corporation or partnership", "B. Applicant corporation", "applicant.company"),
    T("Applicant Street address", "B. Applicant street address", "applicant.address.street_address"),
    T("Applicant Unit number", "B. Applicant unit", "applicant.address.unit"),
    T("Applicant Municipality", "B. Applicant municipality", "applicant.address.city"),
    T("Applicant Postal code", "B. Applicant postal code", "applicant.address.postal_code"),
    T("Applicant Province", "B. Applicant province", "applicant.address.province_state"),
    T("Applicant Email", "B. Applicant email", "applicant.email"),
    T("Applicant Telephone number", "B. Applicant telephone", "applicant.phone"),
    T("Applicant Fax", "B. Applicant fax", "applicant.fax"),
    # C. owner
    T("Owner Last name", "C. Owner last name", "owner.name.__last__"),
    T("Owner First name", "C. Owner first name", "owner.name.__first__"),
    T("Owner Corporation or partnership", "C. Owner corporation", "owner.company"),
    T("Owner Street address", "C. Owner street address", "owner.address.street_address"),
    T("Owner Municipality", "C. Owner municipality", "owner.address.city"),
    T("Owner Postal code", "C. Owner postal code", "owner.address.postal_code"),
    T("Owner Province", "C. Owner province", "owner.address.province_state"),
    T("Owner Email", "C. Owner email", "owner.email"),
    T("Owner Telephone number", "C. Owner telephone", "owner.phone"),
    T("Owner Cell number", "C. Owner cell", "owner.cell"),
    # D. builder - not known until tender
    T("Builder Corporation or partnership (if applicable)", "D. Builder (not known until tender)", "builder.company"),
    # E. Tarion
    C(nh, "E. New home: Yes", pick(st, nh, "Yes"), "permit.new_home", "equals", True, "E. New home under ONHWP Act?"),
    C(nh, "E. New home: No", pick(st, nh, "No"), "permit.new_home", "equals", False, "E. New home under ONHWP Act?"),
    C(reg, "E. Registration required: Yes", pick(st, reg, "Yes"), "permit.new_home_registration_required", "equals", True, "E. ONHWP registration required?"),
    C(reg, "E. Registration required: No", pick(st, reg, "No"), "permit.new_home_registration_required", "equals", False, "E. ONHWP registration required?"),
    # F/G. declarations made by the applicant at submission - never pre-answered
    C(f1, "F. Complete application", "Yes", "permit.declaration_complete", "equals", True, "F. Application meets 1.3.1.3(5)(a)-(d)? (applicant declares)"),
    C("Payment has been made", "F. Fees paid", "Yes", "permit.declaration_fees_paid", "equals", True, "F. Payment of fees made? (applicant declares)"),
    C(f3, "F. Plans & specs", "Yes", "permit.declaration_plans", "equals", True, "F. Accompanied by plans & specs? (applicant declares)"),
    C("This application is accompanied", "F. Documents", "Yes", "permit.declaration_documents", "equals", True, "F. Accompanied by required documents? (applicant declares)"),
    C("The proposed building", "F. No contravention", "Yes", "permit.declaration_no_contravention", "equals", True, "F. Will not contravene applicable law? (applicant declares)"),
    T("Name of Applicant for Declaration", "G. Declaration - applicant name", "applicant.name"),
    P("Date Applicant Signed Main Form", "G. Date (applicant signature)"),
    P("Signature of applicant", "G. Signature of applicant"),
    # Schedule 1 - designer (the architect)
    T("Project Building number street name for Designer Information", "Sch.1 Project street address", "property_address.street_address"),
    T("Project Lot/Concession for Designer Information", "Sch.1 Project lot/concession", "legal_description.lot"),
    T("Project Municipality for Designer Information", "Sch.1 Project municipality", "property_address.city"),
    T("Project Postal code for Designer Information", "Sch.1 Project postal code", "property_address.postal_code"),
    T("Project Plan number / other description for Designer Information", "Sch.1 Project plan number", "legal_description.registered_plan"),
    T("Designer Name", "Sch.1 Designer name", "architect_of_record.name"),
    T("Designer Firm", "Sch.1 Designer firm", "architect_of_record.company"),
    T("Designer Street address", "Sch.1 Designer street address", "architect_of_record.address.street_address"),
    T("Designer Unit no", "Sch.1 Designer unit", "architect_of_record.address.unit"),
    T("Designer Municipality", "Sch.1 Designer municipality", "architect_of_record.address.city"),
    T("Designer Postal code", "Sch.1 Designer postal code", "architect_of_record.address.postal_code"),
    T("Designer Province", "Sch.1 Designer province", "architect_of_record.address.province_state"),
    T("Designer Email", "Sch.1 Designer email", "architect_of_record.email"),
    T("Designer Telephone number", "Sch.1 Designer telephone", "architect_of_record.phone"),
    T("Designer Fax number", "Sch.1 Designer fax", "architect_of_record.fax"),
    C("Design Activities: Large Buildings", "Sch.1 Design activities", pick(st, "Design Activities: Large Buildings", "Large"),
      "permit.designer_activities", "contains", "Large Buildings", "Sch.1 Design activities (check all that apply)"),
    T("Description of designers work", "Sch.1 Description of designer's work", "permit.designer_work_description"),
    T("Designer Name for Declaration", "Sch.1 Declaration - designer name", "architect_of_record.name"),
    C(decl, "Sch.1 Design work exempt from registration", pick(st, decl, "The#20design#20work#20is#20exempt"),
      "permit.designer_exemption_basis", "truthy", True, "Sch.1 Declaration of designer"),
    T("For design work, Basis for exemption from registration and qualification", "Sch.1 Basis for exemption",
      "permit.designer_exemption_basis"),
    P("Date Signed by Designer", "Sch.1 Date (designer signature)"),
    P("Signature of Designer", "Sch.1 Signature of designer"),
]
save("application_permit_construct_demolish", "Application for a Permit to Construct or Demolish (Feb 2026)",
     pdf, fields, [
         "Application number / Permit number / Date received / Roll number - for use by principal authority",
         "Unit / Lot fields for owner, applicant - not applicable",
         "Builder detail fields - builder not known until tender",
         "Tarion registration number - not a new home",
         "Schedule 1 BCIN fields - architect is exempt from BCIN registration",
         "Schedule 2 (on-site sewage system) - municipal services, not applicable",
     ])

# ------------------------------------------------- applicable law checklist
pdf = BLANK / "applicable_law_checklist_2026.pdf"
laws = [  # (field, key, label) in form order
    ("Check Box1", "minor_variance", "Minor variance (Planning Act s.45)"),
    ("Check Box2", "zoning_bylaw_amendment", "Zoning by-law amendment (Planning Act s.34/38)"),
    ("Check Box3", "division_of_land", "Division of land (Planning Act Part VI)"),
    ("Check Box29", "provincial_zoning_orders", "Provincial zoning orders (Planning Act s.47)"),
    ("Check Box5", "site_plan_approval", "Site plan approval (Planning Act s.41)"),
    ("Check Box6", "planning_development_act", "Planning & Development Act s.14, 17(1)"),
    ("Check Box7", "heritage_designated", "Ontario Heritage Act s.30(2), 33, 34"),
    ("Check Box8", "heritage_listed", "Ontario Heritage Act s.27"),
    ("Check Box9", "heritage_district", "Ontario Heritage Act s.42"),
    ("Check Box10", "heritage_study_area", "Ontario Heritage Act s.40.1"),
    ("Check Box11", "heritage_minister", "Ontario Heritage Act s.35.5 & 34.7(2)"),
    ("Check Box12", "conservation_authority_permit", "Conservation Authority permit (CA Act s.28)"),
    ("Check Box13", "nutrient_management", "Nutrient Management Act"),
    ("Check Box14", "milk_act", "Milk Act s.14"),
    ("Check Box15", "child_care", "Child Care and Early Years Act"),
    ("Check Box16", "demolition_of_schools", "Demolition of schools (Education Act s.194)"),
    ("Check Box17", "environmental_assessment", "Environmental Assessment Act s.5"),
    ("Check Box18", "brownfield", "Brownfield redevelopment (EPA s.168)"),
    ("Check Box25", "former_waste_disposal", "Former waste disposal sites (EPA s.46)"),
    ("Check Box20", "mto_permit", "MTO permit (PTHIA s.34/38)"),
    ("Check Box21", "highway_45m", "Within 45 m of a highway / 180 m of intersection"),
    ("Check Box22", "highway_395m", "Within 395 m of a controlled highway intersection"),
    ("Check Box23", "highway_major_traffic", "Major traffic generator within 800 m of a highway"),
    ("Check Box24", "transit_faster_act", "Building Transit Faster Act s.3"),
]
fields = [T("Municipal Address", "Municipal address", "property_address.__oneline__")]
fields += [C(f, label, "Yes", "applicable_laws", "contains", key, "Applicable laws (tick those that apply)")
           for f, key, label in laws]
fields += [
    C("Check Box26", "1. None of the items apply", "Yes", "applicable_law_status", "equals", "none",
      "Applicant declaration: none apply / all complete & attached / some still pending"),
    C("Check Box27", "2. All approvals completed and attached", "Yes", "applicable_law_status", "equals", "complete",
      "Applicant declaration: none apply / all complete & attached / some still pending"),
    C("Check Box28", "3. Approvals not yet completed", "Yes", "applicable_law_status", "equals", "pending",
      "Applicant declaration: none apply / all complete & attached / some still pending"),
    T("Text29", "Declaration - name", "applicant.name"),
    P("Signature32_es_:signer:signature", "Declaration - signature"),
    P("Text31", "Declaration - date"),
]
save("applicable_law_checklist", "Applicable Law Checklist (2026)", pdf, fields, [
    "Application No / Date Received / right-hand 'office use' boxes - for municipal use",
    "Highway Yes/No blanks (p.4) - answered only if those items apply",
])

# ------------------------------------- commitment to general review
# Whitby uses the standard Ontario base form (all municipalities except Toronto):
# see scripts/build_general_review_base.py -> mappings/ontario__commitment_general_review.json
