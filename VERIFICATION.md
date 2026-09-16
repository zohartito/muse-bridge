# Extraction verification — 2026-09-15

The original workflow was Codex operating an existing Muse conversation through its browser tools. Earlier visible sends and replies demonstrated that workflow; there was no separate Muse API client to copy. This repository extracts the procedure and adds a small reusable helper. No other project's code, credentials, connection files, browser profile, or transcript was copied.

## Live hello exchange — 2026-09-15 PDT / 2026-09-16 UTC

The user explicitly requested a hello to Muse, its reply, and a documented trace. Created a dedicated side chat through the visible **New side chat** control, using the existing signed-in Codex in-app browser. Loaded the repository helper into the host browser REPL and sent one greeting through `bridge.send()`. The greeting identified Codex, designated the chat for bridge testing, and requested a short acknowledgement. Muse returned a hello and explicitly confirmed receipt. No second message was sent.

This is a real live send-and-reply observation. The helper's uninterrupted `send()` → `wait()` flow did **not** pass: creating the chat changed its URL and triggered the conversation-change guard. Reading the reply succeeded after explicitly attaching a fresh helper to the newly observed permanent conversation URL.

| Time (UTC) | Operation | Observed result |
| --- | --- | --- |
| Before send | `cua.getState()` | Timed out after 30 seconds and reset the REPL. |
| Before send | `cua.getBrowser({url: 'https://muse.ai'})`, then tab listing | Direct selection succeeded; no existing tabs were listed. Opened the site in a background tab. |
| Before send | Visible side-chat navigation | An initial menu interaction reached the archived-chat view. Returned to the chat list and used **New side chat**; arrived at `/thread/new` with an empty message log. |
| 00:23:52.084 | `bridge.read()` | Zero messages; generation inactive. The chat log and composer matched the helper's selectors. |
| 00:23:52.169 | `bridge.send(greeting)` | `sent`, 83 ms after the send call began. The rendered user message was visible and generation controls were active. |
| 00:23:55.669 | `bridge.wait({timeoutMs: 20000})` | Threw `Conversation changed; attach a new bridge for that thread.` Muse had navigated from `/thread/new` to a permanent thread URL. The immediately following accessibility snapshot showed the assistant's acknowledgement and an enabled composer. |
| 00:24:02.132 | Fresh `createMuseBridge(tab)`, then `read()` | Returned exactly one user message and one assistant acknowledgement; both `busy: false`, with `generating: false`. |
| 00:24:02.137 | Repeat `read()` | Zero changes. The test tab was retained for the user. |

The wait call detected the URL change 3,583 ms after sending; the reply was visible in the following snapshot within that same tool call. This is an observed latency of approximately 3.6 seconds, not a precise server generation duration; browser discovery and navigation took additional time.

The newly observed limitation is specific to attaching at `/thread/new`: the helper pins that provisional URL, then rejects the permanent URL. No automatic rebind, resend, or source-code fix was applied. Existing-thread `send()` → `wait()` success, restart recovery, background wake-up, and asynchronous task completion remain unverified live. This trace omits account-specific URLs, message IDs, unrelated conversation content, and verbatim transcripts.

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

At extraction, `npm test` passed 11 tests, including immediate replies, lost send acknowledgement, uncertainty after cursor restoration, streaming and later handoffs, bounded waits, thread changes, and checkpoint file permissions. The publication preparation below expands this to 16 passing tests. These use a deterministic adapter and temporary state directories, not a remote Muse service.

Plugin manifest and skill frontmatter are checked with the Codex plugin/skill validators. Their Python YAML dependency is installed in a temporary validation environment, not in the user's projects or global Python.

## Isolation

The new repository is a sibling of the original workspace and has its own Git history. No source/runtime/deployment changes or commits were made in the original repository during extraction. Other ongoing work there was allowed to continue. At extraction time, no plugin installation, shared configuration change, persistent monitor, public Git remote, or publication was created.

## Publication preparation: new-chat URL continuity — 2026-09-16 UTC

The live hello above identified the release preparation fix: `snapshot()` pinned `/thread/new`, then treated Muse's permanent URL assignment as navigation to another conversation. Five adapter tests were added first; four failed against the original implementation, reproducing the transition problem and missing provisional-chat send guard.

Updated `scripts/muse-bridge.cjs` to remember a fingerprint of the first send from an empty new chat. It accepts a one-time transition to the observed permanent URL only when the visible log starts with the matching user message and contains no additional user messages. It refreshes the user-message anchor if Muse changes its ID, retains the pending delivery check, and clears the provisional marker. A second send is blocked while the chat still has a provisional URL. Permanent-to-permanent navigation remains rejected.

`npm test` now passes all 16 tests. Added coverage in `test/bridge.test.cjs` includes navigation before and after acknowledgement, changed message IDs, unrelated or ambiguous histories, navigation without sending, subsequent cross-thread rejection, and checkpoint recovery of uncertain delivery. The checkpoint's added optional marker contains a fingerprint, not the message body.

This was the smallest fix supported by the live trace. It does not provide authentication of conversation identity or an exactly-once delivery guarantee. No further live message was sent during publication preparation, so the updated implementation's uninterrupted live `send()` → `wait()` flow remains unverified. The earlier live trace is preserved as observed; its statement that no fix was applied describes that run.

The public README now includes prerequisites, a quick start, a flow diagram, API result meanings, privacy guidance, limitations, and contribution instructions. Added an MIT license and repository metadata. Checked JSON, local README links, and whitespace; scanned the 12 current files and the original commit for common credential patterns and private Muse thread URLs, with no matches. No browser profile, login state, global plugin, or other project's files were changed for publication.
