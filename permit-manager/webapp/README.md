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

## Claude smarts (optional — set an API key)

The dashboard runs fully without any AI. Set `ANTHROPIC_API_KEY` before starting
and three Claude features light up (backend calls the Anthropic API — nothing
runs in your browser):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python webapp/app.py
```

- **Find missing info in documents** — attach a project document; Claude reads
  it and proposes values for the blank fields, each with a confidence flag and
  the exact quote it came from. You review and apply; nothing is written until
  you approve, and it never guesses (fields it can't support are omitted).
- **Research property online** — Claude web-searches free public sources for
  missing property facts (municipality, zoning, legal description, roll
  number), citing a source URL per value.
- **Draft outreach in your voice** — save a short style guide on the Outreach
  page; Claude drafts follow-ups in that voice, adjusted per recipient. Still
  drafts only, still downloadable as `.eml`.

Every suggestion lands on a review screen first — the same "propose, you
approve" principle as the fill engine. Without a key, outreach falls back to the
templated drafts and the document/research buttons show a hint instead.

Model use: `claude-opus-4-8` for extraction/research (accuracy), `claude-sonnet-5`
for drafting. Your API usage is billed to that key.

## Where the hosted agents fit

`../managed-agents/` is an alternative, fully hosted multiagent version (Claude
runs the loop and a sandbox). It's heavier to run; this app + an API key gives
you the same smarts inside the dashboard with far less setup.
