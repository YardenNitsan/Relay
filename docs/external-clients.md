# Use this host's models from another computer

An external agent runs on the **client computer**. Relay supplies model inference on the **host computer**. The client's own sandbox, approvals and tools determine which client files or commands it can access. Relay never executes the tool proposals returned by this API.

## Connect

1. The owner enables **External model access** for your account in Access. This grant is independent of browser chat, cloud providers and workspace access.
2. Sign in to Relay and open **External clients** from navigation or the command palette.
3. Create a named token, choose its lifetime (1–90 days), and copy it once into your client's protected credential storage. Relay stores only its SHA-256 digest. Do not put it in a URL, source file or shared screenshot.
4. Use the displayed endpoint. Host-local applications use `http://127.0.0.1:4315/v1`. Another LAN computer uses the configured **HTTPS LAN origin** followed by `/v1`. `127.0.0.1` on someone else's laptop means that laptop, not the Relay host.
5. Discover actual model IDs through `GET /v1/models`. Choose an ID returned for your account. Local models execute on the host; this gateway does not borrow anyone's cloud keys.

Public clients use the separate Cloudflare Service Auth gateway described in [protocol and gateway setup](research-external-agents.md). The browser's Google login is not a CLI credential. Two independent checks apply: Cloudflare service authentication and a personal Relay inference token. Never publish raw Ollama/LM Studio endpoints.

## Protocols and compatibility

| Endpoint | Implemented boundary |
| --- | --- |
| `POST /v1/responses` | Stateless text, JSON function calls/results, SSE; `store:false`. |
| `POST /v1/chat/completions` | Text and JSON function histories, optional streamed usage. |
| `POST /v1/messages` | Anthropic text/tool-use/tool-result subset, SSE; `?beta=true` accepted. |

Authentication accepts `Authorization: Bearer <Relay token>` or `x-api-key: <Relay token>`. Browser cross-origin scripts are rejected. Complete history is supplied by the client on each request; Relay has no previous-response lookup.

**Current Codex and Claude Code versions have additional protocol features. Their complete compatibility is not certified.** Unsupported custom grammars, reasoning payloads, images, hosted tools and request options fail explicitly. Do not rename a local model “Claude” or “GPT” to imply compatibility or equivalent capability. Use a client configuration supporting this documented text/function subset; [research notes](research-external-agents.md) explain the remaining live-client acceptance gates.

## Privacy and limits

Relay app chats remain persisted and account-private. External API prompts, responses and tool arguments are **not saved in Relay conversations, tasks, events, embeddings or logs**. Only operational metadata is stored: account/token/model IDs, timestamps, status and measured token counts. The inference runtime, your external client and a configured public gateway have their own privacy/logging policies. They are not controlled by this promise about Relay storage.

Each account may have eight active tokens, one queued/running external request, 60 authenticated API requests per minute and 500 admitted inference requests per rolling day. The host accepts at most four external requests queued/running. Execution is capped at 300 seconds or the account's shorter limit. Requests are bounded to 1 MiB, 64 functions, 32,768 conservatively budgeted context tokens and 8,192 output tokens. The scheduler shares one local-model lease with app tasks and rechecks real hardware pressure before inference. It refuses unsafe allocations and never silently drops history.

Revoking a token stops its active request. Account revocation, expiry, emergency stop and remote disablement also invalidate execution. Provider cancellation depends on runtime support; closing the client request cancels Relay's managed request. **Stop all agents** remains the owner's control.
# Cold local-model loads

Authenticated, schema-valid inference requests now use a bounded 330-second socket idle timeout while processing, allowing a cold local model to load before its first response. The independent service deadline remains at most 300 seconds (or the account/token expiry bound), with cancellation, revocation, queue limits and memory admission unchanged. The ordinary listener retains its ten-second idle timeout and 15-second incoming-request deadline; the socket timeout is restored after processing. This follows Fastify's distinction between [socket idle and incoming-request timeouts](https://fastify.dev/docs/latest/Reference/Server/).

The previous ten-second idle timeout closed a real LM Studio acceptance request during loading. A real TCP regression with a 10.5-second silent provider reproduced the closure and now passes. That test uses deterministic inference; live acceptance of the updated build is recorded separately in validation.md. Client/proxy deadlines can still impose shorter limits, and no full third-party CLI compatibility is implied.
