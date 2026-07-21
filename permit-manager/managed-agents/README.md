# Permit Desk — Managed Agents

A hosted multiagent setup that turns a project into a filled, ready-to-sign
permit package. Anthropic runs the agent loop and a per-session sandbox; you
define the agents once (these YAML files) and start a session per project.

## The team

| Agent | Model | Job |
|---|---|---|
| **Permit Desk** (coordinator) | Opus 4.8 | Delegates and sequences the work; relays questions to you; assembles the package. Does no work itself. |
| **Paperwork** | Opus 4.8 | Fills the forms by **running the `permit-manager` tool** (mounted repo) — never re-implements filling, never signs. Asks when a field is missing. |
| **Property Researcher** | Sonnet 5 | Finds missing property facts from **free public web sources**, cited and confidence-flagged. |
| **Voice** | Sonnet 5 | Interviews you once for your email style (stored in a memory store), then drafts in that voice. **Drafts only — never sends.** |

### Why Paperwork runs our tool

Filling *these* forms correctly is the `permit-manager` code in this repo, with
its guardrails: never truncate, wrap long values below the label, **never touch
signature fields**, `signer_known` handling, discipline ordering, checkbox
logic. A generic agent would fill PDFs its own way and lose all of that. So the
Paperwork agent mounts the repo and calls `python -m permit_manager fill …`,
orchestrating the human-in-the-loop asking around tested code.

## Setup (once)

Requires the `ant` CLI, authenticated on a workspace with Managed Agents access.

```bash
cd permit-manager/managed-agents
./setup.sh          # creates env + 4 agents + memory store -> .ids.env
```

## Auth (the only credential)

A **GitHub fine-grained PAT with Contents: Read** on `g0ddley/g0ddley-s-games`,
so the Paperwork agent can mount and run the tool. Web search is built-in;
email is plain-text; there are no MCP servers, so nothing else is needed.

```bash
export GITHUB_TOKEN=<your fine-grained PAT>
```

The mount checks out the `claude/permit-form-manager-vm9h4t` branch (where the
tool lives). Merge that branch to `main` and you can drop the branch pin in
`run_session.py`.

## Run a project

```bash
python run_session.py "Start the permit package for 51 Centre St S, Oshawa — church interior renovations. Applicant Barry Bryan Associates."
```

At the `>` prompt you can:
- type an answer to whatever the team asks,
- `attach /path/to/document.pdf` — uploads it to `/workspace/uploads/` for the
  agents to search,
- `quit` — leaves the session running (re-attach by session id later).

The link printed at startup opens the live session trace in the Console.

## Notes & limits

- **No email sending.** Voice outputs plain text; you send from Outlook. If you
  later want drafts to land in Outlook automatically, that needs a Microsoft
  Graph MCP server + OAuth — not wired here.
- **Free web research only.** Authoritative parcel/legal data (GeoWarehouse,
  MPAC, Teranet) sits behind paid logins the researcher can't reach; it will
  say when a fact needs one of those or you.
- **Signatures stay manual.** Every form goes out unsigned, by design.
- Agents are **persistent and versioned** — edit a YAML and
  `ant beta:agents update --agent-id <id> --version <n> < file.yaml`; don't
  re-run `setup.sh` (it creates duplicates).
