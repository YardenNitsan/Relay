# ADR 012 — OS-account delivery for local browser pairing

Status: accepted, 2026-10-05.

## Problem

Host/Origin/CSRF checks block browser-origin attacks but cannot identify native clients. Automatically issuing an owner cookie to every loopback request gave other local accounts a direct authentication path.

## Decision

Require a one-use, five-minute, 256-bit random pairing code issued by a native CLI into an account-restricted control directory. Store the challenge digest separately and consume it by creating a deterministic claim file with exclusive creation semantics. A claim remains until the code's lifetime has passed, including when session creation fails. This replaces a rename-based implementation that failed a concurrent Windows redemption test. Exchange the code only at a local, origin-checked POST endpoint for the existing HttpOnly session cookie. Persistently invalidate all pre-pairing local sessions once during upgrade. Continue to verify remote users independently through signed Access identities.

## Alternatives

A URL bearer credential leaks into navigation history, screenshots and request logs. A global reusable API key has excessive lifetime and makes revocation coarse. An unauthenticated local issuance endpoint recreates the original flaw. A user-selected password adds password storage, reset and phishing surface to a single-account host tool. Native named pipes/Unix sockets with peer credentials could improve delivery UX later, but still cannot distinguish hostile software sharing the owner identity. A platform-specific signed desktop wrapper is beyond the present browser-based deployment.

## Consequences

Users pair each browser once per session lifetime. Source and portable launchers must resolve the same host data directory. Tests and operational scripts use the actual pairing path. Headless services cannot silently grant browser ownership. ACL setup fails closed. The design protects against unpaired HTTP clients and other unprivileged OS accounts; it does not protect against the same OS account or elevated administrators.
