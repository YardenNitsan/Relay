# Account catalog pagination

Cloud discovery previously requested only `/models`. Anthropic defaults to 20 models per page and Gemini to 50, so later identities could be omitted. The existing normalized model profiles, credential ownership, cache and routing policy remain the integration points; no second provider gateway is introduced.

The catalog collector follows Anthropic's `has_more`/`last_id` through `after_id`, and Gemini's `nextPageToken` through `pageToken`. It encodes tokens as query parameters on the existing fixed provider endpoint, never as navigation URLs. Other provider catalogs retain their single-response behavior. Contracts checked against the official [Claude model list](https://platform.claude.com/docs/en/api/models/list) and [Gemini model list](https://ai.google.dev/api/models) on 2026-10-11.

Discovery publishes only after the complete scan. A later authentication error, malformed page, repeated cursor, revoked credential or exceeded bound discards the collected pages. All pages share the existing discovery deadline and credential revision. A maximum of 20 pages, 2,000 raw entries and 8 MiB of accepted JSON prevents unbounded accumulation. Duplicate identities retain their first metadata observation; unsupported IDs continue through the existing provider compatibility filter. No missing prices, limits or quality scores are invented.

The existing HTTP reader checks its 4 MiB page limit after `response.text()`; these aggregation limits do not establish a streaming allocation bound. That inherited transport limitation remains visible for the broader resource-exhaustion review.

Before the fix, six of seven new integration cases failed; credential revocation already passed. The first corrected run passed all 50 affected provider cases. Independent review added six more boundary cases, including final-page revocation, cumulative limits, duplicate metadata and a complete twentieth page; all 13 pagination cases pass. Integrated strict tests and build are recorded in the acceptance ledger when finished.

These tests use synthetic provider responses. They establish Relay's pagination and fail-closed behavior, not live account compatibility, inference entitlement or task quality. Real connected-provider acceptance remains outstanding.
