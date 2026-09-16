# Working on the bridge

This is a standalone extraction. Keep changes inside this repository; do not modify another project's runtime, login state, browser profile, agent instructions, or plugin installation as a side effect.

Use `npm test` (no dependencies). Browser access comes from the host's documented tools. Keep Muse selectors in `readMuseDOM` and the send composer; do not add private API calls, account-specific URLs, cookies, or transcripts to the source.

`VERIFICATION.md` distinguishes live observations from adapter tests. A passing adapter test is not a new live Muse exchange. Use an explicitly intended test conversation for future send verification, rather than injecting diagnostics into someone else's active work.
