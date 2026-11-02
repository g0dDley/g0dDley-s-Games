# Permit Form Manager

A local tool for an intern architect doing construction administration: fill
building-permit forms from known project data, track who owes a signature, and
draft follow-up emails — **without ever guessing a value or touching a
signature.**

Jurisdiction: Ontario / OBC. Starting forms: the EABO *Owner Commitment to
Have General Review Undertaken* (the "Owner Authorization") and the municipal
*Application for a Permit to Construct or Demolish*.

### Standard Commitment to General Review (Ontario, outside Toronto)

`forms/blank/ontario/commitment_general_review_eabo_fillable.pdf` is the base
form for **every Ontario project outside the City of Toronto** unless a project
says otherwise. It is the EABO *Commitment to General Review by Architect and
Engineer* made fully fillable (it stays editable after filling):

* page 1 - the standard form (Part A + Part B blocks 1-4);
* page 2 - *Part B - Continued*: the same header and rule, blocks 5-6 only.

Consultants are placed in checkbox order (Architectural, Structural,
Mechanical, Electrical, Site Services, Other); outside consultants whose signer
isn't known show company + address only. Signatures and dates are never
filled. Rebuild with `PYTHONPATH=src python scripts/build_general_review_base.py`;
fill with `python -m permit_manager fill --project <id> --form ontario__commitment_general_review`.

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

## Signatures (authorized only)

Signature/date fields are `protected` and never receive mapped data. A
signature image is placed **only** when a party is explicitly
`signature_authorized` **and** has a `signature_asset` (PNG) on file — used for
in-house BBA signers whose signatures we're permitted to reuse:

- **Nick Swerdfeger** — architectural/design
- **David Bovill** — structural (**Doug McLaughlin** is the alternate)

By default **no signatures are placed at all** — every Signature and Date field
is left blank for manual signing.

**Unknown consultant signer** (`signer_known: false`, the default for outside
consultants): the individual who will sign often isn't known when the form goes
out. For those blocks the form shows only the **firm's Company + address** and
**checks the discipline box** — the person's name, phone, email, signature and
date are left blank for them to complete. In-house blocks where the signer is
known (`signer_known: true`, e.g. BBA's Nick/David) show the full name and
contact.

Part B blocks are laid out top-to-bottom in the **checkbox order**
(Architectural, Structural, Mechanical, Electrical, Site Services, Other),
regardless of the order consultants appear in the profile. Authorized signers are marked
`signed` in the tracker automatically; the review summary flags every applied
signature as **AUTHORISED SIGNATURE — confirm permission + date**.

The date beside an authorized signature is **always today's date**, applied at
fill time.

Signature PNGs live in `assets/signatures/` and are **gitignored — local only,
never committed** (see that folder's README). They are prepared once (cropped,
white background made transparent, form rules removed, and normalized to a
common ink darkness so all signatures read with similar weight). If an asset is
missing, the block is simply reported as awaiting a signature.

## Guardrails

- Signature and signature-date fields are marked `protected` and are **never**
  written from a data mapping. They are only ever filled by an explicitly
  authorized signature (above); a consultant's signature is never applied.
- Fields with no confident mapping are left **unmapped** (never guessed) and
  surfaced in the summary.
- Missing values are **never** filled with placeholder text. An empty mapped
  field is left blank and the summary flags it as *needs manual entry or an
  attachment* — with a suggestion from known info where one exists.
- AI-proposed (low-confidence) mappings are shown but **not written** unless you
  pass `--approve-low`.
- If a blank form's checksum changes, the fill step warns that the cached
  mapping is stale instead of silently misfilling.

### Overflow: never truncate, never overlap

A value is **never** truncated. Each overlay field has two placement slots: an
*inline* slot (right of the label) and a *wrap* slot (a full-width line in the
whitespace just below the label). If a value fits inline without overlapping the
next cell it goes inline; otherwise the whole value is written on the wrap line
below the label — shrinking the font within a floor if needed — so it never
runs over the form's printed text. The project *description* is taken from the
short project **name** so it fits at the top of the form on one line.

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
