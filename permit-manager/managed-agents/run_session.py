#!/usr/bin/env python3
"""Start a Permit Desk session and drive it interactively.

Mounts the permit-manager repo and the email-style memory store, opens the
event stream, sends your kickoff message, then loops: prints the agents' output
and, whenever the team pauses for input, lets you type an answer or attach a
document for it to read.

Prereqs:
  - `pip install anthropic`, on a workspace with Managed Agents access
    (ANTHROPIC_API_KEY set, or `ant auth login` profile active).
  - `./setup.sh` has been run (creates .ids.env).
  - GITHUB_TOKEN = fine-grained PAT, Contents:Read on g0ddley/g0ddley-s-games.

Usage:
  python run_session.py "Start the permit package for 51 Centre St S, Oshawa."
  # then at the > prompt: type answers, `attach /path/to/doc.pdf`, or `quit`.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from anthropic import Anthropic

REPO_URL = "https://github.com/g0ddley/g0ddley-s-games"
REPO_BRANCH = "claude/permit-form-manager-vm9h4t"   # merge to main to simplify later
WORKSPACE = "default"                               # your Console workspace slug

HERE = Path(__file__).parent


def load_ids() -> dict[str, str]:
    ids: dict[str, str] = {}
    for line in (HERE / ".ids.env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            ids[k] = v
    return ids


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('Usage: python run_session.py "<kickoff message>"')
    kickoff = sys.argv[1]

    ids = load_ids()
    gh_token = os.environ.get("GITHUB_TOKEN")
    if not gh_token:
        sys.exit("Set GITHUB_TOKEN (fine-grained PAT, Contents:Read on the repo).")

    client = Anthropic()

    session = client.beta.sessions.create(
        agent=ids["COORD_ID"],
        environment_id=ids["ENV_ID"],
        title="Permit package",
        resources=[
            {
                "type": "github_repository",
                "url": REPO_URL,
                "authorization_token": gh_token,
                "mount_path": "/workspace/repo",
                "checkout": {"type": "branch", "name": REPO_BRANCH},
            },
            {
                "type": "memory_store",
                "memory_store_id": ids["STYLE_STORE_ID"],
                "access": "read_write",
                "instructions": "Email style guide for the Voice agent - "
                                "email_style.md lives here.",
            },
        ],
    )
    print(f"Session: {session.id}")
    print(f"Watch it live: https://platform.claude.com/workspaces/{WORKSPACE}/sessions/{session.id}\n")

    # Stream first, then send the kickoff (so no early events are missed).
    stream = client.beta.sessions.events.stream(session.id)
    client.beta.sessions.events.send(
        session.id,
        events=[{"type": "user.message", "content": [{"type": "text", "text": kickoff}]}],
    )

    while True:
        for event in stream:
            t = event.type
            if t in ("agent.message", "agent.thread_message_received"):
                for block in getattr(event, "content", []) or []:
                    if getattr(block, "type", None) == "text":
                        print(block.text)
            elif t == "session.thread_status_running":
                print(f"  [{getattr(event, 'agent_name', 'subagent')} working...]")
            elif t == "session.status_terminated":
                print("\n[session terminated]")
                return
            elif t == "session.status_idle":
                stop = getattr(event, "stop_reason", None)
                if stop and getattr(stop, "type", None) == "requires_action":
                    continue  # waiting on a tool result the SDK handles; keep reading
                break  # end_turn / awaiting your reply -> drop to the prompt
        else:
            return  # stream closed

        # The team is waiting on you.
        try:
            reply = input("\n> ").strip()
        except EOFError:
            reply = "quit"
        if reply.lower() in ("quit", "exit", ""):
            print("Leaving the session running; re-attach any time by session id.")
            return
        if reply.lower().startswith("attach "):
            path = Path(reply[len("attach "):].strip()).expanduser()
            if not path.is_file():
                print(f"  (no such file: {path})")
                continue
            up = client.beta.files.upload(file=path.open("rb"), purpose="agent")
            client.beta.sessions.resources.add(
                session.id, type="file", file_id=up.id,
                mount_path=f"/workspace/uploads/{path.name}",
            )
            reply = f"I've attached {path.name} at /workspace/uploads/{path.name} - please search it."
        client.beta.sessions.events.send(
            session.id,
            events=[{"type": "user.message", "content": [{"type": "text", "text": reply}]}],
        )


if __name__ == "__main__":
    main()
