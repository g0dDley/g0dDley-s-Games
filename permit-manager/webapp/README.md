# Permit Desk — dashboard

A minimal local web dashboard over the `permit-manager` engine. Track multiple
permit applications, fill the Owner Commitment to General Review form, see each
signer's status, and upload signed copies as they come back. No API key.

## Run it

```bash
cd permit-manager
pip install -r requirements.txt
python webapp/app.py
```

Open **http://localhost:5000**.

## What you can do

- **Dashboard** — every application with its municipality, form status
  (`not started → filled → partially signed → complete`) and signature count.
- **New application** — name + municipality; it creates the project.
- **Fill / Re-fill** — runs the tested engine (never truncates, never signs,
  orders Part B by discipline). Shows a live preview and an assumption summary.
- **Missing info** — fields the fill flagged as empty appear as inline inputs;
  fill them and re-fill. (For full control, edit the profile JSON at the
  bottom of the page.)
- **Signatures** — per-signer status you can update (`drafted → sent → signed →
  received`).
- **Signed copies** — upload a signed PDF each time a consultant signs; tick who
  signed in that copy and their status flips. Every upload is kept and listed.
- **Outreach** — generates plain-text drafts for outstanding signers, each
  downloadable as an Outlook-ready `.eml` (never sends).

## Data

Everything lives under `permit-manager/data/projects/<id>/` — `profile.json`
(the project data), `tracker.json` (signatures), `filled/` (output PDF +
preview), `signed/` (uploaded signed copies), `drafts/` (outreach). Generated
output (`filled/`, `drafts/`) is gitignored; the profile and tracker are kept.

## Sharing / hosting

It's a standard Flask app. To share on a network, run behind a WSGI server
(e.g. `gunicorn webapp.app:app`) — add auth before exposing it publicly, since
there's none built in.

## Where the AI agents fit

This dashboard is deterministic and needs no model. The optional "smarts" —
mapping brand-new municipal forms, researching missing property facts online,
drafting emails in your voice — live in `../managed-agents/` (hosted Claude
agents). They can plug in behind dashboard buttons later; the core tracking and
filling don't depend on them.
