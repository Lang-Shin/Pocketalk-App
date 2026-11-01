# Local model integration

## Status

Not integrated. The assistant currently runs through `MockAssistantProvider`, which uses the existing deterministic rules engine. No local LLM runtime, model file, native module, or cloud fallback is installed. The mock is not a language model and must not be presented as one.

Run the Phase 5 prototype with `npm install` and `npm start`, then open the Assistant tab. Run the tests with `npm test`. Mock mode requires no model download, native build, or internet access.

Phase 6 owns confirmation, transaction execution, ledger writes, and AI-draft audit persistence. Phase 5 only interprets and displays validated drafts/answers.

## Target device and model

- Device: OPPO Reno8 5G (CPH2359)
- SoC: MediaTek Dimensity 1300
- GPU: ARM Mali-G77 MC9
- RAM: 8 GB physical LPDDR4x
- Storage: 256 GB UFS 3.1
- OS: Android; the actual installed major version must be checked on the device
- Model: `Qwen2.5-1.5B-Instruct` (Apache-2.0)
- Initial quantized target: `Q4_K_M` where supported, approximately 0.93-1.0 GB for the GGUF weights
- Initial context target: 2,048-4,096 tokens, not the model's full context

Virtual RAM / memory expansion must not be counted as physical RAM. Capacity decisions must use physical RAM and actual available memory.

## Runtime comparison

| Runtime | Expo/RN fit | Qwen2.5-1.5B support | Native requirements | Assessment |
|---|---|---|---|---|
| `react-native-executorch` 0.10.x | Explicitly supports Expo SDK 57 / RN 0.86 and the New Architecture | Pre-exported quantized 8da4w `.pte` is about 1.1 GiB; not Q4_K_M | Development build/prebuild, native libraries, `react-native-blob-util`, Babel/worklets setup, Android 13+ and iOS 17+ per docs | Primary candidate when explicit Expo SDK 57 compatibility is the priority |
| `llama.rn` 0.12.x | New Architecture; Expo config plugin; development build required | Loads Qwen2.5 GGUF directly, including Q4_K_M | Development build/prebuild; Android arm64-v8a; model stored outside the app binary | Primary candidate if Q4_K_M and JSON-schema/GBNF constrained output are mandatory; RN 0.86 compatibility must be verified in a dev build |
| LiteRT-LM | Android/iOS native; no documented official React Native binding | Qwen2.5-1.5B artifacts exist | Custom native Android/iOS bridge and build integration | Defer unless the native bridge cost is justified |

Both `react-native-executorch` and `llama.rn` would require a development build. Expo Go cannot load these native libraries. The current app has no `android/` or `ios/` project, so adopting either runtime requires prebuild/CNG changes.

## Recommendation

Do not integrate a runtime until the target device's Android major version and available physical memory are confirmed and a development-build spike is approved.

If compatibility with the current Expo SDK 57 / RN 0.86 stack is the deciding factor, evaluate `react-native-executorch` first with its quantized Qwen2.5-1.5B artifact. Its documented Android 13+ requirement blocks it if the phone remains on Android 12.

If Q4_K_M is mandatory and constrained JSON is required, evaluate `llama.rn` first with the Qwen2.5-1.5B-Instruct Q4_K_M GGUF and JSON-schema/GBNF output. Verify that its native build works with RN 0.86 before committing to it.

The model file must not be bundled in the APK/AAB. It must only be downloaded after explicit user action showing the model name, size, source, and storage impact. The download must be integrity-checked and removable.

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

- The actual Android major version on the OPPO Reno8 5G is not confirmed. `react-native-executorch` requires Android 13+ per its documentation.
- No development build or native toolchain run has been performed for either candidate.
- No model has been downloaded or benchmarked.
- Dimensity 1300 uses a Mali GPU; `llama.rn` OpenCL support is Qualcomm Adreno-focused, so CPU-only inference is the realistic baseline.
- No conclusion about latency, thermal behavior, memory pressure, or structured-output reliability should be made without the procedure above.
