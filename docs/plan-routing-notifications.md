# Routing visibility, safe agent execution and completion alerts

User-authorized continuation, 9 October 2026. Preserve the in-progress private-file, Google connection and token-efficiency work; integrate and validate together before restart and GitHub publication.

## Intended behavior

- Opening Models fetches the current installed Ollama/LM Studio catalog, with shared in-flight discovery and bounded authenticated refresh requests.
- Specialist conversations use the same model selection, privacy, account, context and hardware admission as ordinary tasks. No specialist may force an unsafe model to run.
- Auto's actual selected model is visible during execution and in the saved task. Model changes follow real execution records, never simulated model labels.
- Completion creates an in-app notification and optionally a browser notification after explicit browser permission. Alerts are deduplicated, contain no private task text, and distinguish completion from failure or attention needed. Closed-browser push is outside this implementation.
- Hardware safeguards include admission before selection and after acquiring the shared local lease, plus bounded monitoring of live free memory. Abort/pause on unsafe pressure; never force another unsafe attempt.

## Implementation and evidence

Existing provider, task/event and browser query boundaries remain authoritative. Use one shared local lease across browser tasks and external inference. Add deterministic tests for specialist routing, changing resource pressure, reconnect/replay notification behavior, artifact-bound calibration and discovery refresh. Run the full backend suite, build, real browser flows and desktop/phone inspection, then restart the compiled host and verify the public authentication boundary and actual local inference.

Google configuration still needs the owner's real client registration; live consent cannot be fabricated. No general claim of optimal model selection or zero host-crash risk is made. Resource measurements, a small fixed probe and browser notification support have explicit limits.
