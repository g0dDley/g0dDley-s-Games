"""Known-project-data schema.

A single ``ProjectProfile`` per project is the only place data is *read* from
when filling forms. Nothing in the fill path ever writes back here.

Ontario / OBC shaped: legal description uses lot / registered plan /
concession / part / roll number; licences are OAA + BCIN.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Address(BaseModel):
    street_address: str = ""
    unit: str = ""
    city: str = ""
    province_state: str = "ON"
    postal_code: str = ""
    country: str = "CA"

    def one_line(self) -> str:
        bits = [self.street_address]
        if self.unit:
            bits.append(f"Unit {self.unit}")
        tail = ", ".join(b for b in [self.city, self.province_state, self.postal_code] if b)
        if tail:
            bits.append(tail)
        return ", ".join(b for b in bits if b)


class Contact(BaseModel):
    name: str = ""            # "First Last"
    company: str = ""
    license_number: str = ""  # OAA / BCIN / PEO, where applicable
    address: Address = Field(default_factory=Address)
    phone: str = ""
    fax: str = ""
    email: str = ""


class LegalDescription(BaseModel):
    lot: str = ""
    registered_plan: str = ""
    concession: str = ""
    part: str = ""
    roll_number: str = ""

    def one_line(self) -> str:
        parts = []
        if self.lot:
            parts.append(f"Lot {self.lot}")
        if self.registered_plan:
            parts.append(f"Plan {self.registered_plan}")
        if self.concession:
            parts.append(f"Conc. {self.concession}")
        if self.part:
            parts.append(f"Part {self.part}")
        return ", ".join(parts)


class Municipality(BaseModel):
    name: str = ""                 # e.g. "City of Oshawa"
    province_state: str = "ON"
    country: str = "CA"


class Permit(BaseModel):
    # construct | demolish | both  (drives the EABO "construct or demolish" wording)
    type: Literal["construct", "demolish", "both"] = "construct"
    purpose: list[str] = Field(default_factory=list)  # New construction / Addition / Alteration/Repair / Demolition
    work_description: str = ""
    current_use: str = ""
    proposed_use: str = ""
    value_estimate: str = ""       # kept as string to preserve "1,000,000" formatting
    area_sq_m: str = ""
    application_number: str = ""


class Party(Contact):
    signature_required: bool = True


class Consultant(Contact):
    # EABO Part B disciplines. One consultant => one Part B block.
    discipline: Literal[
        "ARCHITECTURAL", "STRUCTURAL", "MECHANICAL",
        "ELECTRICAL", "SITE SERVICES", "OTHER",
    ] = "STRUCTURAL"
    discipline_other: str = ""     # text when discipline == "OTHER"
    role_label: str = ""           # free text, e.g. "Structural Engineer of Record"
    signature_required: bool = True


class ProjectProfile(BaseModel):
    project_id: str
    project_name: str = ""
    municipality: Municipality = Field(default_factory=Municipality)
    property_address: Address = Field(default_factory=Address)
    legal_description: LegalDescription = Field(default_factory=LegalDescription)
    permit: Permit = Field(default_factory=Permit)

    owner: Party = Field(default_factory=Party)
    applicant: Party = Field(default_factory=Party)
    applicant_same_as_owner: bool = False
    architect_of_record: Contact = Field(default_factory=Contact)

    # EABO Part A: "coordinator of the work of all architects and engineers"
    coordinator: Contact = Field(default_factory=Contact)

    # EABO Part B: one entry per retained architect / engineer (max 4 per page)
    consultants: list[Consultant] = Field(default_factory=list)

    # ---- persistence -------------------------------------------------
    @classmethod
    def load(cls, path: str | Path) -> "ProjectProfile":
        return cls.model_validate_json(Path(path).read_text())

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.model_dump(), indent=2))


def resolve_path(profile: ProjectProfile, dotted: str):
    """Resolve a mapping target like 'owner.name' or 'consultants.0.company'.

    Returns None when the path or a list index does not exist, so callers can
    treat a missing value the same as an unmapped field (left blank).
    """
    node = profile
    for part in dotted.split("."):
        if node is None:
            return None
        if isinstance(node, list):
            try:
                node = node[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            node = getattr(node, part, None)
    return node


if __name__ == "__main__":  # dump JSON Schema for reference
    print(json.dumps(ProjectProfile.model_json_schema(), indent=2))
