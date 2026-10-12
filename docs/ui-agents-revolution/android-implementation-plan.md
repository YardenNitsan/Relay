# LAN-first Android Implementation Plan

> For agentic workers: use superpowers:executing-plans for this bounded native increment. Root approved implementation after the initial audit; no production/network configuration changes are authorized.

**Goal:** Build an actual native Kotlin/Compose debug APK operating through existing authenticated Relay LAN HTTPS APIs.

**Architecture:** One Android app module with separate protocol, encrypted session storage, HTTP/SSE transport, ViewModel and Compose screens. Existing host policy remains authoritative. Cloudflare remote OAuth remains a later gated integration.

**Tech stack (resolved and built):** Gradle 9.6.0, AGP 9.4.0, Kotlin/Compose compiler 2.4.21, Compose BOM 2026.09.00 (Compose 1.12.1, Material3 1.4.0), adaptive 1.3.0, Activity 1.13.0, Lifecycle 2.11.0, coroutines 1.11.0 and OkHttp 5.5.0. Compile/target SDK 37, minSdk 26, default build tools 36.0.0, local JBR21 with Java17 bytecode. Exact commands and verification scope: [Android validation](android-validation.md).

**Spec:** [android-architecture.md](android-architecture.md), [threat-model.md](threat-model.md), existing `docs/lan-access.md`.

## Constraints

- Only `android/`, `docs/ui-agents-revolution/android-*`, `threat-model.md` and ignored `release/android` artifacts belong to this task.
- Do not change production listeners, firewall, DNS, TLS trust, Cloudflare settings, routes, backend APIs or host configuration.
- HTTPS with platform TLS trust only; no trust-all, HTTP fallback, owner pairing or service token.
- Stable debug signing uses the existing user `.android/debug.keystore`, never copied into the repository. Debug APK is testing distribution, not a signed production release.
- No fixture data or inert product buttons; JVM test doubles are explicitly test-only.
- No physical-device, connected-host or Access acceptance claims without observed evidence.

## Contract audit and LAN feasibility

LAN is a separate private HTTPS listener configured explicitly by the owner. It uses `Sessions(store,true)` but no Cloudflare identity adapter. `POST /api/session/pair` with JSON `{token}` and exact Origin redeems a five-minute one-use LAN invitation, then returns `{csrfToken,user,remote:true,connection:"lan",hostName}` plus Secure HttpOnly Strict `__Host-relay_remote`. User ID comes from the invitation. `GET /api/session` reuses the cookie and returns a fresh in-memory CSRF view; without valid cookie it returns `LAN_PAIRING_REQUIRED`. Expiry/revocation requires a new invitation, never silent owner admission. `POST /api/session/logout` requires the same cookie and CSRF. Owner-only issuance is `POST /api/admin/users/:id/lan-invitation` and is not called by the app. Sources: `server/auth/lan.ts`, `server/api/app.ts:156`, `:182`, `server/auth/sessions.ts`.

Private LAN connectivity is feasible without backend changes. It remains conditional on a configured/reachable LAN origin and certificate trusted by Android. This implementation does not establish that deployment. It is not an alternative public path around Access; no LAN Internet forwarding is added. Remote Access URLs are rejected/explained rather than proxied or authenticated by copied cookies.

Read endpoints: `/api/conversations`, `/api/conversations/:id` (messages/tasks), `/api/tasks/:id` (steps/events/approvals/verification/changes), `/api/assistants` (capabilities), `/api/models` (account-permitted models), `/api/workspaces`, `/api/workspaces/:id/files`, `/api/workspaces/:id/file?path=...`, `/api/events?after=...&scope=...`.

Mutation endpoints: `/api/conversations/start` requires UUID `requestId`, `content` and full `TaskOptions`; `/api/conversations/:id/messages` requires `content/options`; `/api/tasks/:id/cancel`; `/api/approvals/:id` takes `{decision:"allow_once"|"denied"}`. App sends cookie/CSRF/exact Origin and no automatic mutation retries. Initial send preserves request ID/payload; follow-up uncertain delivery reconciles before deliberate retry. No local owner controls are offered.

## Work units

- [x] Foundation/security: create pinned wrapper verified against official checksum, Android manifest (no cleartext/backup), protocol tests for exact HTTPS origins, cookie envelopes and safe errors; run failing tests before implementation; implement Keystore AES-GCM protected session storage and cookie scoping.
- [x] Transport/state: authenticated login/restore/logout, bounded JSON requests, safe error classification, foreground SSE plus snapshot refresh, session epochs, serialized busy actions and uncertain-send handling. Unit test protocol parsing and storage envelope tamper resistance.
- [x] Native screens: connection/invitation; conversation history and send; task/steps/activity/approval/cancel; assistant capability browsing and selection; project/file read; loading/error/empty states from actual backend. Preserve drafts and avoid hidden actions.
- [x] Verification/artifact: JVM tests, Android lint, actual debug APK assembly, APK signature verification/checksum. If emulator launch is feasible, inspect real UI without demo data and label scope. Copy only APK/checksum to ignored release/android and document exact reproduction commands/remaining gaps.

## Review focus

Cross-account cookie/late-response leakage; hostile URLs/redirects; invalid certificate behavior; expired invitation and session; malformed/oversized events; foreground/background cancellation; duplicate uncertain sends; exact approval consequences; server changes during file/task reads; large font/IME/RTL/Back.

## Deferred

Access Managed OAuth, verified App Links, background push, public Play release signing, device folder writes, remote owner operations, native branch publication/integration, independent host/app compatibility negotiation, general durable mobile outbox, and physical-device acceptance.
