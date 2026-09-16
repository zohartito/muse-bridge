---
name: muse-director-loop
description: Run Muse as a free, fast implementer under a technical-director agent (Astra, Claude, Cursor, anyone) — write a master PRD and changelog, hand the repo to Muse, review its commits independently, and send prioritized fix rounds until acceptance. Use when the user wants Muse to do the coding while another agent directs and reviews.
---

# Muse director loop

Roles: the **user** owns scope and acceptance. The **director** (whichever agent runs this skill) writes the contract and reviews. **Muse** implements. Muse is cheap and fast and makes mistakes; the loop exists to catch them with evidence, not to trust reports.

Transport to Muse is the [muse-bridge](../muse-bridge/SKILL.md) skill (`muse send/wait/read` or the MCP tools). The user needs a Muse account signed in once via `muse login`, and Muse needs GitHub access to the repo (a scoped fine-grained token the user creates; never create or paste credentials yourself).

## 1. Set up the repo

1. Create or pick the GitHub repo; clone it locally.
2. Commit `docs/MASTER_PRD.md` (numbered requirements, each with observable acceptance criteria), `docs/EXECUTION_PLAN.md` (stages), `CHANGELOG.md` (entry format), `AGENTS.md` (roles, working rules, completion report), and `handoffs/001-muse-build.md` (the first task, written for Muse).
3. Push to `main`. Muse only ever sees `main` and its own `muse/*` branch.

Worked example: `github.com/zohartito/muse-september-2026` (Buildboard v1, reviews 001–002).

## 2. Hand off to Muse

Open a dedicated Muse thread (`muse new` or an observed URL) and send one message:

> Connect to `<repo url>`. Fetch latest `main` (SHA `<sha>`). Read `AGENTS.md`, `docs/MASTER_PRD.md`, `CHANGELOG.md`, then execute `handoffs/001-muse-build.md`. Implement on branch `muse/<feature>`, push, open a draft PR. Do not merge or deploy. Return branch, commit SHA, PR URL, commands run with observed results, and anything unverified.

The PRD comes from the director and Muse must follow it; contradictions are reported, not silently resolved.

## 3. Wait, then verify independently

`muse wait` until Muse reports a SHA and PR. Then, on the user's machine:

- `git fetch origin && git checkout <sha>`; run install, tests, build yourself.
- Exercise the real app (browser, CLI) at the acceptance criteria. Passing unit tests are not acceptance.
- Try to break it: data integrity, reload/recovery, import/export, edge inputs, accessibility names, duplicate listeners.

## 4. Write and send the review

Commit `reviews/NNN-<director>-review.md` to `main`: the SHA reviewed, what passed, then numbered findings (R1…) each with severity, exact reproduction, and required fix plus regression test. End with a return protocol (same branch, same draft PR, pull latest main first, no merge, return SHA and checks).

Send Muse one short message pointing at the file:

> Review NNN of `<sha>` is on `main` (`<review sha>`). Pull latest main, read `reviews/NNN-...md` in full, fix R.. on `muse/<branch>`, update draft PR #N, add regression tests for every reproduction, rerun tests and build, update CHANGELOG with actual evidence. Do not alter the PRD, merge, or deploy. Return the new SHA and actual checks.

## 5. Repeat

Each Muse fix commit gets a fresh independent verification and a new numbered review until the director has no reproducible findings. Only then tell the user it is ready for their acceptance and merge decision. Never let Muse mark requirements verified from tests alone; never rewrite acceptance criteria to make a failure pass.
