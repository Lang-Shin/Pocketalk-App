# Local model integration

## Status

Not integrated. The assistant currently runs through `MockAssistantProvider`, which uses the existing deterministic rules engine. No local LLM runtime, model file, native module, or cloud fallback is installed. The mock is not a language model and must not be presented as one.

Run the Phase 5 prototype with `npm install` and `npm start`, then open the Assistant tab. Run the tests with `npm test`. Mock mode requires no model download, native build, or internet access.

Phase 6 owns confirmation, transaction execution, ledger writes, and AI-draft audit persistence. Phase 5 only interprets and displays validated drafts/answers.

## Phase 5.5 Section A baseline

Recorded on 2026-11-01:

- Expo SDK 57, React Native 0.86.3, React 19.2.3, TypeScript 6.0.3
- New Architecture; no `android/` or `ios/` project
- No development client, local-model runtime, model artifact, model download, or device-capability module
- Active assistant provider: `MockAssistantProvider`, wrapped by `ValidatedAssistantProvider`
- `npm test`: 151/151 passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npx expo-doctor`: 21/21 passed
- Android export: passed
- Web export: passed
- `git diff --check`: passed

These are JavaScript/bundling checks. No native development build, model load, offline inference, memory, latency, thermal, or physical-device AI test has been performed.

## Target device and model

- Device: OPPO Reno8 5G (CPH2359)
- SoC: MediaTek Dimensity 1300
- GPU: ARM Mali-G77 MC9
- RAM: 8 GB physical LPDDR4x
- RAM expansion: 4 GB currently enabled; excluded from all capacity calculations
- Storage: 256 GB UFS 3.1
- OS: Android 14
- ColorOS: 14.0
- Model: `Qwen2.5-1.5B-Instruct` (Apache-2.0)
- Initial quantized target: `Q4_K_M` where supported, approximately 0.93-1.0 GB for the GGUF weights
- Initial context target: 2,048-4,096 tokens, not the model's full context

Virtual RAM / memory expansion must not be counted as physical RAM. Capacity decisions must use physical RAM and actual available memory.

## Phase 5.5 Section B — Runtime compatibility evidence

Access date for all sources: **2026-11-01**.

Evidence labels:

- **Verified:** stated by official documentation or official package metadata.
- **Documented but untested:** officially documented, but not verified in Pocketa.
- **Assumption:** planning hypothesis requiring validation.
- **Unknown:** no reliable evidence yet.
- **Known incompatibility:** contradicts the current architecture or target.

### Verified official documentation

- Expo SDK 57 targets React Native 0.86; `expo@57.0.17` moved the project to React Native 0.86.3. The current app uses SDK 57 and RN 0.86.3.
- `react-native-executorch` requires the New Architecture and a development build; Expo Go is not supported.
- The ExecuTorch compatibility table explicitly lists `react-native-executorch` 0.10.x as supporting React Native 0.86 and Expo SDK 57.
- ExecuTorch documents `react-native-worklets` `>=0.10.0 <0.14.0`, `react-native-blob-util`, and the `react-native-worklets/plugin` Babel plugin as requirements.
- ExecuTorch documents Android 13+ and iOS 17+.
- The ExecuTorch Qwen2.5-1.5B XNNPACK artifact is 8da4w, approximately 1.1 GiB, with a 16,384-token context, published for ExecuTorch v1.4.1. It is not a Q4_K_M artifact.
- `llama.rn` v0.10+ requires the New Architecture and documents an Expo config plugin, development build, GGUF loading, and GBNF/JSON-schema constrained output.
- `llama.rn` documents Android arm64-v8a/x86_64 support and OpenCL acceleration limited to Qualcomm Adreno GPUs and Q4_0/Q6_K data types.
- LiteRT-LM officially supports Android/iOS and lists Qwen2.5-1.5B as a supported model, with Kotlin, Swift, JavaScript/web, C++, Python, and Flutter APIs.
- Qwen2.5-1.5B-Instruct is Apache-2.0, has 1.54B parameters, and supports a 32,768-token context.

### Documented but untested for Pocketa

- Loading and running Qwen2.5-1.5B on the OPPO Reno8 5G.
- Actual memory, latency, thermal, battery, and stability behavior.
- Structured-output reliability of Qwen2.5-1.5B for Pocketa’s interpretation schema.
- `react-native-executorch` 0.11.0 compatibility: npm `latest` resolves to 0.11.0, but the fetched compatibility table lists 0.10.x as the RN 0.86 row and does not show a 0.11.x row.
- `llama.rn` compatibility with React Native 0.86: its documentation has no explicit RN 0.86 compatibility matrix. The npm `latest` tag resolves to `0.13.0-rc.9`, a pre-release-named version.
- Building either runtime in this Expo SDK 57 project, which currently has no `android/`, `ios/`, or development-client project.
- CPU-only Q4_K_M inference on the Dimensity 1300’s Mali GPU.

### Assumptions

- 8 GB physical RAM may be enough for Qwen2.5-1.5B with a modest 2-4K context, but this is unmeasured.
- The 4 GB RAM-expansion setting provides no reliable additional model capacity and is excluded.
- A model can be provisioned outside the app binary and loaded locally during the spike.
- Development-build overhead is acceptable for the feasibility test.
- Model download can be user-initiated and integrity-checked in a later integration step.

### Unknowns

- Pocketa’s minimum supported Android API level and physical RAM threshold.
- Whether ExecuTorch 0.11.0 is compatible with RN 0.86 despite the missing table row.
- Whether `llama.rn` builds cleanly with Expo SDK 57 / RN 0.86.
- Whether Q4_K_M is necessary or ExecuTorch’s 8da4w artifact is sufficient.
- Which model quantization and context length provide acceptable quality and latency.
- Whether Qwen2.5-1.5B can reliably produce the required structured JSON.
- Actual available memory after ColorOS 14.0 overhead.
- iOS support requirements and timeline.

### Known incompatibilities and blockers

- Expo Go cannot load custom native runtime libraries.
- `react-native-executorch` requires Android 13+; the OPPO test device runs Android 14, but the product minimum is unresolved.
- LiteRT-LM has no documented official React Native binding and would require a custom native bridge.
- `llama.rn` OpenCL acceleration is Qualcomm-Adreno-focused; the Dimensity 1300 uses Mali, so CPU inference is the realistic baseline.
- Q4_K_M is not the ExecuTorch Qwen2.5 artifact format.

### Runtime comparison

| Runtime | Version evidence | Expo/RN fit | Qwen2.5-1.5B support | Native requirements | Assessment |
|---|---|---|---|---|---|
| `react-native-executorch` | 0.10.x explicitly supports RN 0.86 / Expo 57; npm `latest` is 0.11.0; `legacy` is 0.10.7 | Verified for 0.10.x; 0.11.0 row not shown | 8da4w `.pte`, about 1.1 GiB, 16,384-token export; not Q4_K_M | Development build/prebuild, New Architecture, worklets 0.10+, `react-native-blob-util`, Babel plugin, Android 13+/iOS 17+ | First spike candidate, subject to version and device verification |
| `llama.rn` | npm `latest` is 0.13.0-rc.9; no explicit RN 0.86 matrix | New Architecture and Expo plugin documented; RN 0.86 untested | GGUF Qwen2.5 support, including Q4_K_M; GBNF/JSON-schema output | Development build/prebuild, Expo plugin, Android arm64-v8a; CPU on Mali | Fallback if Q4_K_M/constrained JSON is required; RC and build compatibility are risks |
| LiteRT-LM | Official Qwen2.5-1.5B support; no RN API | No official React Native binding | `.litertlm`, listed around 1,598 MB in official model table | Custom native Android/iOS bridge | Defer unless native bridge cost is justified |

### Section B recommendation

No final runtime is selected. The first spike candidate is `react-native-executorch` **0.10.x**, because it has the only explicit RN 0.86 / Expo SDK 57 compatibility evidence found. The current 0.11.0 package must be checked separately before use.

Use `llama.rn` as the fallback spike only if Q4_K_M or JSON-schema/GBNF output is mandatory, and only after verifying RN 0.86 and Expo build compatibility. Do not adopt the current RC package without a stability review.

LiteRT-LM is not a practical first integration because it requires a custom React Native native bridge.

The model file must not be bundled in the APK/AAB. It must only be downloaded after explicit user action showing the model name, size, source, and storage impact. The download must be integrity-checked and removable.

### Sources

| Source | Access date |
|---|---|
| [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) | 2026-11-01 |
| [React Native ExecuTorch compatibility](https://docs.swmansion.com/react-native-executorch/docs/other/compatibility) | 2026-11-01 |
| [React Native ExecuTorch getting started](https://docs.swmansion.com/react-native-executorch/docs/fundamentals/getting-started) | 2026-11-01 |
| [npm `react-native-executorch` dist-tags](https://registry.npmjs.org/-/package/react-native-executorch/dist-tags) | 2026-11-01 |
| [Software Mansion Qwen2.5 ExecuTorch artifacts](https://huggingface.co/software-mansion/Qwen2.5-ExecuTorch) | 2026-11-01 |
| [llama.rn repository README](https://github.com/mybigday/llama.rn) | 2026-11-01 |
| [npm `llama.rn` dist-tags](https://registry.npmjs.org/-/package/llama.rn/dist-tags) | 2026-11-01 |
| [LiteRT-LM overview](https://developers.google.com/edge/litert-lm/overview) | 2026-11-01 |
| [LiteRT-LM repository](https://github.com/google-ai-edge/LiteRT-LM) | 2026-11-01 |
| [Qwen2.5-1.5B-Instruct model card](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) | 2026-11-01 |

## Required provider boundary

`src/ai/providers/assistantProvider.ts` defines the provider interface, including `load()`, `unload()`, and interpretation methods. `src/ai/providers/mockAssistantProvider.ts` is the only implementation. A future local provider must keep model lifecycle, prompt construction, inference, cancellation, and unload behavior behind this boundary; screens must not call runtime APIs directly.

The local provider must return the existing structured `AssistantResult`/`AssistantInterpretation` contract and pass all financial values through the existing deterministic validation layer. It must never write to finance storage.

## OPPO Reno8 5G verification procedure

These checks have not been performed. Do not claim device verification until they are recorded on the physical phone.

### Preconditions

1. Confirm the phone model, SoC, physical RAM, Android version, and free storage:
   - `adb shell getprop ro.product.model`
   - `adb shell getprop ro.build.version.release`
   - `adb shell cat /proc/meminfo | Select-String MemTotal,MemAvailable`
   - `adb shell df -h /data`
2. Record `MemTotal` as physical RAM. Do not use extended/virtual RAM.
3. Install a development build with the local provider disabled by default. Confirm the app still starts and the mock provider works.
4. Confirm the app binary does not contain the model. Record the installed APK/AAB size.
5. Download the model only through an explicit user action. Record the exact model filename, size, source, checksum, and download time.

### Model loading

1. Enable the local provider explicitly.
2. Record process memory before loading.
3. Load the model and record:
   - success/failure and error text
   - cold load time
   - memory after load
   - whether the UI remains responsive
4. Repeat with the model file missing and corrupted. Confirm a clear failure state and no crash.

### Offline inference

1. Put the phone in airplane mode and disable Wi-Fi.
2. Run the fixed prompt suite described below.
3. Confirm no network requests are needed for inference.
4. Restore connectivity and confirm the app does not silently switch to a cloud provider.

### Structured JSON extraction

Use a fixed suite that covers:

- expense
- income
- wallet transfer
- container transfer
- missing amount
- ambiguous container
- unsupported request
- read-only balance question

For each response, record whether it parses as JSON, matches the schema, preserves integer minor-unit amounts, includes explicit `missingFields`, and contains no invented wallet/container/date. Run each prompt multiple times and report malformed or inconsistent counts. Constrained/schema-guided decoding should be enabled if the runtime supports it.

### Latency

For each of at least 10 runs, record:

- time to first token
- total generation time
- prompt/prefill time
- decode tokens per second
- prompt and output token counts
- median and p95 latency
- cancellation behavior

Use a fixed context length (start at 2,048 tokens) and a fixed output limit. Do not compare against desktop or cloud benchmarks.

### Memory pressure and stability

Record app PSS/RSS and system `MemAvailable`:

- before model load
- after model load
- during inference
- after unload

Run a repeated inference loop and record:

- OOM kills
- Android low-memory-killer activity
- ANRs
- app restarts
- SQLite/finance data intact after restart
- thermal throttling and battery drain

The app must remain usable for normal budgeting if the model fails to load or is unloaded.

### Unload and reload

1. Unload the model and record memory after unload.
2. Reload it three times.
3. Confirm no duplicate native contexts, no leaked memory growth, and no finance data changes.
4. Background/foreground the app and confirm the documented lifecycle behavior.

### Usability during inference

While inference is running, verify:

- tab navigation remains responsive
- scrolling remains smooth
- input and keyboard remain usable
- cancellation works
- no blocking of the finance database or SQLite operations
- no accidental transaction writes

## Current blockers

- The OPPO Reno8 5G reports Android 14, which satisfies `react-native-executorch`’s documented Android 13+ requirement for this one device. Pocketa’s minimum supported Android version remains unresolved, so this does not establish product-wide compatibility.
- No development build or native toolchain run has been performed for either candidate.
- No model has been downloaded or benchmarked.
- Dimensity 1300 uses a Mali GPU; `llama.rn` OpenCL support is Qualcomm Adreno-focused, so CPU-only inference is the realistic baseline.
- No conclusion about latency, thermal behavior, memory pressure, or structured-output reliability should be made without the procedure above.
