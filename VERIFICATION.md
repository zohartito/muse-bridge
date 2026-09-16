# Extraction verification — 2026-09-15

The original workflow was Codex operating an existing Muse conversation through its browser tools. Earlier visible sends and replies demonstrated that workflow; there was no separate Muse API client to copy. This repository extracts the procedure and adds a small reusable helper. No Nook code, credentials, connection files, browser profile, or transcript was copied.

## Live, read-only check

Used a separate temporary background tab in the existing signed-in Codex in-app browser. The helper was defined in the browser REPL and called against the actual Muse UI:

| Check | Observed result |
| --- | --- |
| Find an open Muse thread | 1 |
| Read loaded messages using message IDs/roles | 40 |
| Roles | user, assistant |
| Preserve rendered message links | 3 |
| Immediately read again | 0 changes |
| Recreate helper with its checkpoint, then read | 0 changes |
| Zero-duration wait on an unchanged chat | `waiting` |
| New messages sent to Muse | 0 |

The message log, composer, `data-message-*` boundaries, and assistant `aria-busy` state were inspected in the actual rendered page. No private text, URLs, message IDs or screenshots are included here. The temporary tab was closed afterward. An initial broad browser inventory request timed out; selecting the relevant browser directly worked.

This verifies discovery, the current read adapter, change tracking and in-memory checkpoint restoration. It does **not** establish fresh live send/wait round-trip delivery, cold-account onboarding, saved-checkpoint recovery after a host restart, whole-account conversation search, or automatic wake-up. The helper's visible-send operation is extracted from the earlier working sequence; this extraction deliberately did not send a diagnostic into active work.

## Local checks

`npm test`: 11 passing tests, including immediate replies, lost send acknowledgement, uncertainty after cursor restoration, streaming and later handoffs, bounded waits, thread changes, and checkpoint file permissions. These use a deterministic adapter and temporary state directories, not a remote Muse service.

Plugin manifest and skill frontmatter are checked with the Codex plugin/skill validators. Their Python YAML dependency is installed in a temporary validation environment, not in the user's projects or global Python.

## Isolation

The new repository is a sibling of the original workspace and has its own Git history. No source/runtime/deployment changes or commits were made in the original repository during extraction. Other ongoing work there was allowed to continue. No plugin installation, shared configuration change, persistent monitor, public Git remote, or publication was created.
