# Permit Form Manager

A local tool for an intern architect doing construction administration: fill
building-permit forms from known project data, track who owes a signature, and
draft follow-up emails — **without ever guessing a value or touching a
signature.**

Jurisdiction: Ontario / OBC. Starting forms: the EABO *Owner Commitment to
Have General Review Undertaken* (the "Owner Authorization") and the municipal
*Application for a Permit to Construct or Demolish*.

## Core principle

Nothing is finalised, sent, or marked-as-sent automatically. Every fill prints
an **assumption summary** — what was filled, which mapping was used (new vs.
cached), what was left blank and why, and anything low-confidence — plus a PNG
preview for flat forms. You review and approve.

## The three cooperating pieces

1. **Field mapping + fill** — introspects a form's fields the first time it
   sees a municipality's form, caches the mapping, and reuses it thereafter.
   Fills only confidently-matched fields; leaves signature/date fields blank
   **always**.
2. **Signature tracker** — one record per (form, party) per project:
   `drafted → sent → signed → received`, and who it's waiting on.
3. **Outreach** — reads the tracker for outstanding signatures and drafts
   (never sends) follow-up emails, tailored owner vs. consultant.

## Two fill strategies

| Strategy   | When | How |
|------------|------|-----|
| `acroform` | PDF has fillable form fields | named fields filled with **pypdf** |
| `overlay`  | flat PDF, no form fields (e.g. the EABO form) | text drawn at label-anchored coordinates with **PyMuPDF**, verified via PNG preview |

The strategy is detected on introspection and recorded in the mapping cache, so
you don't choose it per-fill.

## Guardrails

- Signature and signature-date fields are marked `protected` and are **never**
  written, regardless of any mapping.
- Fields with no confident mapping are left **unmapped** (never guessed) and
  surfaced in the summary.
- AI-proposed (low-confidence) mappings are shown but **not written** unless you
  pass `--approve-low`.
- If a blank form's checksum changes, the fill step warns that the cached
  mapping is stale instead of silently misfilling.

## Layout

```
permit-manager/
  config/settings.toml
  forms/blank/<municipality>/<form>.pdf   # blank masters
  mappings/<municipality>__<form>.json    # the mapping cache (one per form)
  data/projects/<project_id>/
      profile.json    # known project data (the only data source for fills)
      tracker.json    # signature tracker
      filled/<form>.pdf + <form>.preview.png
      drafts/<form>__<role>.json          # outreach drafts (not sent)
  src/permit_manager/
      schema.py introspect.py mapping.py fill.py tracker.py outreach.py
      review.py cli.py
  tests/
```

## Data files

**`profile.json`** — see `schema.py` (`python -m permit_manager` → the models).
Ontario-shaped: legal description = lot / registered plan / concession / part /
roll number; licences = OAA + BCIN. Contacts (owner, applicant, architect,
coordinator, consultants) share one shape; `consultants` is a list, one per
EABO Part B block, each carrying its `discipline`.

**Mapping cache** — one JSON per municipality+form. Each field records the
target data path, the fill placement (AcroForm field name, or anchor rect +
placement for overlay), `protected`, and `confidence` (`high` / `low` /
`n/a`). It stores the blank form's `pdf_sha256` for staleness detection.

## Usage

```bash
pip install -r requirements.txt

# 1. inspect a form (shows AcroForm vs FLAT and which fields are protected)
python -m permit_manager introspect forms/blank/ontario_eabo/owner_commitment_general_review.pdf

# 2. build/refresh the mapping cache for a flat EABO form
python -m permit_manager map-eabo forms/blank/ontario_eabo/owner_commitment_general_review.pdf \
    --municipality "City of Oshawa"

# 3. fill for a project + print the assumption summary + preview PNG
python -m permit_manager fill --project 2025-51-centre-st-parish-hall \
    --form city_of_oshawa__owner_commitment_general_review

# 4. track signatures
python -m permit_manager track --project <id> --init <form_id>     # seed from profile
python -m permit_manager track --project <id> --set "<form_id>/owner=sent"
python -m permit_manager track --project <id>                      # show status

# 5. draft outreach for anything outstanding (writes JSON drafts, sends nothing)
python -m permit_manager outreach --project <id>
```

## Gmail (MCP) handoff

`outreach` only writes draft JSON (`to`, `subject`, `body`) to
`data/projects/<id>/drafts/`. Creating the actual Gmail draft is a separate,
explicit step through the Gmail MCP tool after you approve the text. Emails are
never auto-sent.

## Tests

```bash
PYTHONPATH=src python -m pytest tests -q
```

Covers the guardrails: signature/date fields are never filled, empty values are
left blank rather than guessed, and discipline checkboxes fill correctly.
