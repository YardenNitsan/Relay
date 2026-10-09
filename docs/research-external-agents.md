# External coding clients and stateless local inference

Research date: 9 October 2026. Implementation: `server/inference/protocols.ts`.

## Current primary-source findings

Codex supports named providers with a configured base URL and credential environment variable. Its current configuration reference specifies Responses as the supported wire protocol; Chat Completions alone is insufficient. WebSocket support is separately configurable. Relay's HTTP integration should set `wire_api = "responses"` and `supports_websockets = false`. The client supplies its complete history because Relay has no stored response retrieval or continuation service. [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

OpenAI Responses represents function proposals and function results as separate input/output items joined by `call_id`. Its API also has persistence, images, hosted tools and other features that are beyond text/function translation. Relay rejects unsupported features rather than silently dropping them. [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create)

Responses streams identify output items and content indices and end with an explicit completion event. Relay emits created/in-progress events, text item/content events, function argument events and the complete final response. OpenAI Chat Completions uses indexed choice deltas and a final completion marker, with a separate optional usage chunk. [Responses streaming reference](https://developers.openai.com/api/reference/resources/responses/streaming-events), [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

Claude Code supports an Anthropic Messages gateway using `ANTHROPIC_BASE_URL`. `ANTHROPIC_AUTH_TOKEN` supplies a bearer token, while `ANTHROPIC_API_KEY` supplies an API-key header. These are gateway credentials; a local Relay token is neither an Anthropic subscription nor an Anthropic API key. The official documentation describes gateway model discovery as optional. It does not establish that every arbitrary model implements every Claude Code feature. [Connect Claude Code to a gateway](https://code.claude.com/docs/en/llm-gateway-connect)

The current Claude Code gateway guide specifies `/v1/messages`, including requests with `?beta=true`. Token counting is optional: without it the client can estimate context use. The guide also describes changing beta fields, provider-side tools and context features. An adapter implementing only basic Messages cannot honestly claim complete Claude Code compatibility. Streaming must preserve final message events; buffering the entire answer delays client feedback. [Claude Code gateway compatibility](https://code.claude.com/docs/en/llm-gateway-protocol)

Anthropic's ordinary Messages API supports stateless multi-turn histories. Client tool calls use `tool_use` blocks and corresponding `tool_result` blocks. Its SSE format uses message start, indexed content block start/delta/stop, a message delta and message stop. Token counts in message deltas are cumulative. [Messages API](https://platform.claude.com/docs/en/api/messages/create), [Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)

## Implemented protocol boundary

The adapter exports `parseInferenceRequest`, `encodeInferenceResponse`, `encodeInferenceStream` and `encodeInferenceError`. `ParsedInferenceRequest` contains normalized messages and function schemas, the requested model, output limit and streaming preferences. The caller supplies model execution and a response identity. The module does not select providers, execute tools, import a tool broker, write files, retain history or persist responses. Its only retained state is bounded memory for the current request/response. Authentication, resource admission, revocation, time limits and content-free operational accounting belong to the service/gateway boundary.

Supported input is text and complete client-owned JSON function histories in Responses, Chat Completions and Anthropic Messages formats. System/developer instructions are normalized to the local runtime's system role. Tool results must match unique earlier calls; all outstanding calls must be resolved before another user turn. Anthropic tool-result errors remain identified in the model-visible result. `tool_choice:none` removes available functions. Parallel calls can be disabled; a model producing multiple calls despite that setting fails validation.

Requests are limited to 1 MiB of UTF-8 JSON, 256 incoming messages/items, 512 normalized messages, 64 functions, depth 32 and 20,000 JSON nodes. Function schemas are limited to 16 KiB, depth 16 and 512 nodes. References, regular-expression constraints, formats and content schemas are rejected to keep validation bounded and avoid network schema resolution. Each function output must satisfy its supplied schema even when `strict` is false. Function argument objects are limited to 64 KiB. This is a stricter documented subset of provider APIs, not an arbitrary JSON Schema service.

Output defaults to 2,048 tokens and accepts explicit limits up to 8,192; model context/hardware admission can impose tighter limits. Visible text and function arguments together are capped at 1 MiB, with at most 65,536 normalized chunks and 64 proposals. Text streams as it arrives. Function proposals are emitted only after the entire provider stream, terminal status and schemas validate, preventing clients from acting on an interrupted argument sequence. Tool results are never interpreted as host capabilities. The external client remains responsible for its own permissions and tool execution.

Provider-private continuation/reasoning fields are discarded. OpenAI response usage is `null` if no measurement arrives. Anthropic streams begin with explicitly provisional zero counters (`relay_usage_status:pending`), replace them with measured input/output counters in the final message delta, and label them `measured`. Those starting counters are not a measurement. Because the final Messages object requires counters, an Anthropic-format response without actual usage fails rather than inventing totals. Interrupted/invalid provider streams have no successful completion footer; the HTTP route must report a protocol error and close the stream.

## Explicit limits and validation status

There is no `previous_response_id`, conversation lookup, stored response history, background execution, embeddings, image/audio/document input, provider-managed tool execution, free-form custom tool grammar, encrypted reasoning-item replay or compaction protocol. `store:true` is rejected. Unsupported sampling, forced-tool selection, reasoning and JSON-output constraints are rejected because the current shared runtime request cannot enforce them. Known text defaults, function `strict` flags and explicit disabled thinking are accepted. Prompt-cache fields and beta context controls are not silently ignored.

Accordingly, a default installation of a current Codex or Claude Code client can still send an unsupported request. The integration must be described as a tested text/function protocol subset until the particular installed CLI and selected local model pass real end-to-end acceptance. A JSON-only chat test does not establish a working coding-agent tool loop. Do not rename local models as Claude or GPT to imply provider identity or equivalent capability.

Deterministic tests cover all three request formats, stateless tool round trips, SSE text/tool events, measured and unknown usage, Unicode byte limits, unsupported features, malicious schema references, ambiguous tool histories, invalid function arguments, private continuation suppression, output limits and provider interruption. They do not claim actual Codex CLI or Claude Code execution. No cloud credential or public deployment is needed for these tests.

## Optional public inference: a separate service-authenticated gateway

Cloudflare distinguishes human application identities from service application tokens. The latter have `type:app`, an empty `sub`, and `common_name` identifying the service client. Both need verified signatures and application audience checks. Relay's inference service verifier accepts the service shape only; a valid browser login JWT cannot substitute for it. It restricts verification to RS256 and the configured Cloudflare team issuer/audience, requires valid issued/expiry times and returns only the expiry in milliseconds. It does not create a Relay user or grant account access. [Cloudflare application tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)

Configure a **separate Cloudflare Access application** for the inference hostname, with a **Service Auth** policy allowing selected service tokens. Clients supply `CF-Access-Client-Id` and `CF-Access-Client-Secret`; Cloudflare authenticates them and attaches its signed `Cf-Access-Jwt-Assertion` for the origin. In addition, each inference request must carry its own Relay user's inference bearer token (or the supported API-key header). Keep service credentials in the client's protected secret/environment configuration. They are not cloud-model API credentials and must not be put in a URL or committed config. [Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

The inference hostname and audience are separate from the browser Access settings. In this release the owner's **remote-access enable/disable switch** governs both public listeners, so first configure browser remote access and enable it in Access. Inference-only deployments without that owner control are not enabled:

```dotenv
RELAY_INFERENCE_REMOTE_ENABLED=1
RELAY_INFERENCE_REMOTE_ORIGIN=https://inference.example.com
RELAY_INFERENCE_ACCESS_ISSUER=https://your-team.cloudflareaccess.com
RELAY_INFERENCE_ACCESS_AUDIENCE=your-separate-inference-application-audience
RELAY_INFERENCE_REMOTE_PORT=4320
```

The final port is an optional override; 4320 is the default dedicated loopback origin listener. Route only the inference hostname to this listener through the owner's authenticated outbound tunnel. Do not route it to local owner port 4317, standalone local inference port 4315, browser Access port 4318 or the LAN interface. The public URL is an address; successful access requires **both** independently verified gateway service identity and a live, authorized Relay account token. Signed gateway expiry must also bound an in-flight stream. Disabling optional public infrastructure leaves the local listener independent.

These settings contain deployment identifiers only. The host verifier obtains public signing keys from its configured team's fixed `/cdn-cgi/access/certs` endpoint; token-supplied key URLs are never used. Key retrieval has a five-second timeout and a cooldown. Missing, duplicate, malformed or oversized JWT headers fail closed. This module does not install a tunnel, configure Cloudflare policies, enroll service clients, open firewall ports or provision a public hostname.

The automated service-identity tests use real ephemeral RSA signatures and an injected local key set. They cover issuer/audience/signature/algorithm checks, browser and organization token rejection, missing claims, future issuance, expired tokens, input bounds and independent configuration. A real Cloudflare deployment and current external CLI execution remain separate acceptance work; passing these tests does not certify either.
