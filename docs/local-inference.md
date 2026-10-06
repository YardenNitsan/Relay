# Local inference and resource policy

Updated 2026-10-05. Provider API research and the measured thinking-only Qwen failure are documented in [research-providers.md](research-providers.md).

## Owner-controlled host profiles

Resource policy is a host setting, stored under `settings.resource_policy`. It is independent of conversation depth, cloud spending and task permissions. The local owner chooses the profile. Remote users and model-generated task plans cannot lower reserves by supplying a task option.

| Profile | Physical RAM reserve | Discrete VRAM reserve |
| --- | --- | --- |
| Safe, default | Greater of 4 GiB or 20% of total RAM | Greater of 1 GiB or 15% of total VRAM |
| Balanced | Greater of 3 GiB or 15% | Greater of 1 GiB or 12% |
| Performance | Greater of 2 GiB or 10% | Greater of 1 GiB or 10% |
| Custom | Explicit values, at least 2 GiB and 10% | Explicit values, at least 1 GiB and 10% |

The Safe defaults preserve the original admission policy. Other profiles allow more memory to be considered for inference while retaining deterministic floors. They are application policies, not vendor-certified safe limits. Performance can reduce responsiveness and is not a throughput guarantee. Custom absolute reserves must be finite values from the minimum through 256 GiB; percentages must be between 10 and 75. Invalid values, unknown fields and attempts to override a named preset are rejected. Reserve calculations round upward to whole bytes.

All profiles retain the same model estimate: quantized weights, architecture-derived f16 KV cache for the requested context, runtime buffers and load overhead. They retain the same freshness limit, unknown-telemetry refusal, swap-pressure check and serialized local execution. They cannot make an unsupported hybrid architecture known, count swap as physical RAM or present an estimate as measured memory.

The controller must read the current owner setting for every admission, including the recheck after acquiring the local execution lease. A policy change affects subsequent admissions during an existing task. It does not resize or revoke an already-running runtime allocation. Emergency stop remains a separate control.

## Backend integration

`server/hardware/policy.ts` exports:

- `resourcePolicySchema`: strict runtime validation and the `ResourcePolicyConfig` type.
- `resolveResourcePolicy(config?)`: concrete reserve values; omitted configuration resolves to Safe.
- `resourceProfiles()`: labels, descriptions and concrete preset values for controls; Custom starts with Safe values.
- `resourcePolicyBounds`: validation bounds for numeric controls.

`server/hardware/config.ts` exports `getResourcePolicy(store)` and `saveResourcePolicy(store, value)`. Saving validates before mutation, then updates the setting and records `RESOURCE_POLICY_CHANGED` in one transaction. Reads have no cache so admission sees current policy. Missing configuration means Safe; malformed persisted configuration fails closed. Authorization belongs to the API: only the authenticated local owner may call the write path.

`assessModel(model, hardware, contextTokens, policy?)` consumes the validated setting. Its explanation includes the selected profile and reserves. There is no per-task resource-policy field and no shared browser model type change.

## Different memory architectures

Discrete NVIDIA and AMD cards use measured per-device total/used VRAM where available, with the selected VRAM reserve. Missing used memory remains unknown and blocks automatic GPU admission. Vendor identity alone does not establish runtime compatibility. An admitted Ollama CPU fallback is sent as `num_gpu:0`; the full weight/cache/buffer estimate must independently fit physical RAM.

Apple Silicon and integrated devices reported as sharing system memory use one physical RAM budget. They do not gain a second capacity pool by adding GPU memory to RAM. The discrete VRAM fields in a Custom profile do not apply to a unified-memory device. Apple's `hasUnifiedMemory` describes whether GPU and CPU share memory; its device-specific recommended working-set limit is an additional consideration. Relay does not currently bind native Metal working-set telemetry and continues to label admission as estimated. See [Apple unified-memory metadata](https://developer.apple.com/documentation/metal/mtldevice/hasunifiedmemory) and [recommended GPU working set](https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize).

CPU-only hosts use physical RAM and the same reserve floors. Low-memory hosts can be refused under every profile. A larger pagefile does not change that outcome. AMD and Intel tests verify policy behavior; they do not certify a particular accelerator or driver. Consult [Ollama's current hardware support](https://docs.ollama.com/gpu) for runtime compatibility.

## Residency, measurements and lifecycle

`Providers.residentModels()` reads Ollama's `/api/ps` without generating text, loading models or unloading them. It returns `observed`, `unavailable` or `disabled`, a timestamp, source and up to 100 records. A record includes model ID, digest, runtime-reported resident bytes, GPU bytes, context size and expiry. Missing counters remain null; unavailable inventory is distinct from an observed empty list. The `truncated` field indicates a bounded partial inventory. See [Ollama running-model API](https://docs.ollama.com/api/ps).

These counters are resident-allocation observations. They are not measured peak memory, independently attributable host RAM use, permission to unload, or proof that a previously rejected model is safe. Whole-host before/after deltas can include other applications. Windows WDDM and unified/NUMA memory accounting also affect interpretation of GPU counters; see [NVIDIA's memory-query reference](https://docs.nvidia.com/deploy/pdf/NVML_API_Reference_Guide.pdf) and [nvidia-smi documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html).

Actual generation throughput continues to be collected from completed runtime calls and stored by `MeasuredProviders`, matched to model digest and hardware configuration. No synthetic throughput or memory calibration is created by changing a resource profile. A future calibrated peak-memory record must identify runtime version, model digest, hardware, context, batch/parallelism, cache precision and offload configuration, then measure an isolated load/generation rather than repurpose a resident sample.

Ollama offers `keep_alive` and unload operations, but Relay uses a shared external runtime. A model previously used by Relay can simultaneously belong to another application's work. The runtime inventory does not provide exclusive caller ownership. Therefore this version does not implement automatic unloading or an unload control. A future lifecycle controller needs a dedicated Relay-owned runtime or an enforceable ownership/lease boundary. See [Ollama retention and concurrency controls](https://docs.ollama.com/faq).

## Validation

`tests/resource-policy.test.ts` exercises unchanged defaults, all profiles, enforced custom floors, invalid persisted values, transactional changes, low-memory refusal, discrete NVIDIA/AMD behavior, Apple/Intel unified memory and CPU-only operation. Existing hardware tests continue to cover KV growth, stale telemetry, unknown architectures and enforced CPU fallback. Provider tests verify that residency uses only a read-only request and preserves unknown values.

No model generation is needed by these tests. Current cross-platform coverage uses deterministic hardware fixtures; actual macOS and AMD/Intel hardware validation remains an explicit release gate.
