# Current LAN address renewal — 13 October 2026

The PC's Ethernet address changed from `10.100.102.30` to `10.100.102.13/24`. Previous host listeners were stopped when inspected. The old certificate correctly could not authenticate the new IP; no TLS check was disabled.

The reviewed launcher now accepts an explicit canonical RFC1918 IPv4 address, verifies that exact address on an active noninternal interface, and retains fixed owner4327/LAN4443 ports and its existing marked private data directory. Public, loopback, wildcard, link-local, CGNAT, malformed and injected addresses are rejected. Focused launcher/TLS tests: **64 passed, 1 skipped**; typecheck passed.

Android's build-only generator validates the explicit private IPv4 address and emits a single literal domain with `includeSubdomains=false`. Both `relayLanCaFile` and `relayLanHost` must be supplied together. Default/release trust remains system-only. Generator checks: **51 passed**. Build and installed acceptance for native0.4 are pending until recorded below.

The old CA is constrained to the former IP, so a separate IP13 CA and leaf were generated using the installed OpenSSL3.5.4. Old material was preserved. New server files: `%LOCALAPPDATA%/RelayDispatchLan/tls-10-100-102-13`; signer: `%LOCALAPPDATA%/RelayDispatchLanIssuer/ip-10-100-102-13`. Both directories have current-user-only ACLs. RSA3072/SHA256, CA pathlen0, critical name constraints IP13/32 and reserved `relay-lan.invalid`, leaf IP13/serverAuth. No private key is a build input.

Public CA SHA256 fingerprint: `1EA48BD0EF27CEF85269D85E63E8C661E381678CD83D87218B4247469E33ED4E`.

The current foreground preview is PID13284/tool session2542. TLS-verified `https://10.100.102.13:4443/` returned200 and unauthenticated `/api/tasks` returned401. The owner browser at `http://127.0.0.1:4327` is authenticated in a separate private `browser-current13` profile (session45274); its actual1440×960 screenshot was inspected. Existing preview data and LAN account were retained. Production was not started or replaced. No router, Cloudflare, firewall or system trust-store change was made.

The existing bounded LM Studio startup helper started only its localhost1234 runtime. A real authenticated LAN account then submitted `Reply with exactly: Relay LAN connected.` through the same conversation API used by Android. Task `ffd67b8a-fea7-4ef7-9be5-42e035a9c6ae` completed in43.2seconds with exactly `Relay LAN connected.` using the explicitly selected existing9B model and unchanged resource admission. One model call, no cloud usage. This proves this simple real API generation, not all agent capabilities or installed-native streaming. Prior RAM-paused evidence remains valid historical evidence.

Raw evidence is ignored `output/ui-agents-revolution/current-lan-generation-evidence.json` and `lan-web-current-1440.png`. Fresh native build/install, notifications, physical Samsung, phone-browser trust and full product acceptance remain separate gates.

Actual authenticated Chrome read-only navigation checked Work, Agents and Projects at320?740,390?844,768?1024,1440?960 and2560?1440 in light/dark themes:30 combinations, no document overflow. Representative mobile/desktop screenshots inspected. This is a live-host smoke check, not a replacement for the existing interaction/accessibility suite. The initial bundled-headless-browser launch failed because that binary was absent; the successful run used installed Chrome through Playwright.
