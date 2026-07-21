"""Signature tracker - one record per (form, party) per project.

File-based (JSON). Records who each form is waiting on and where it is in the
drafted -> sent -> signed -> received lifecycle.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

STATUSES = ["drafted", "sent", "signed", "received"]


@dataclass
class SignatureRecord:
    form_id: str
    form_title: str
    party_role: str            # "owner" | "consultant:structural" | ...
    recipient_name: str = ""
    recipient_email: str = ""
    status: str = "drafted"    # one of STATUSES
    date_sent: str = ""
    date_signed: str = ""
    date_received: str = ""
    notes: str = ""

    @property
    def key(self) -> str:
        return f"{self.form_id}::{self.party_role}"


class Tracker:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.records: list[SignatureRecord] = []
        if self.path.exists():
            for r in json.loads(self.path.read_text()):
                self.records.append(SignatureRecord(**r))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps([asdict(r) for r in self.records], indent=2))

    def upsert(self, rec: SignatureRecord) -> SignatureRecord:
        for existing in self.records:
            if existing.key == rec.key:
                return existing
        self.records.append(rec)
        return rec

    def set_status(self, form_id: str, party_role: str, status: str) -> None:
        assert status in STATUSES, f"unknown status {status!r}"
        for r in self.records:
            if r.form_id == form_id and r.party_role == party_role:
                r.status = status
                today = date.today().isoformat()
                if status == "sent":
                    r.date_sent = today
                elif status == "signed":
                    r.date_signed = today
                elif status == "received":
                    r.date_received = today
                return
        raise KeyError(f"no record for {form_id}/{party_role}")

    def outstanding(self) -> list[SignatureRecord]:
        """Records still waiting on a signature (drafted or sent, not signed)."""
        return [r for r in self.records if r.status in ("drafted", "sent")]
