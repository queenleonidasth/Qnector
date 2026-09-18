# Concise TypeScript symbol outline — local smoke benchmark

Date: 2026-09-18, Windows, QNECTOR source checkout on `feat/durable-runtime-foundation`. Compared the existing `TypeScriptCodeIntelligence.documentSymbols` (full detail) with the new `outline:true` mode and the minimal field projection returned by `workspace.document_outline`. Same file `packages/core/src/code-intelligence.ts`, same service instance, sequential execution, four calls per mode (first cold, subsequent three warm); measured in-process wall time using `performance.now`, serialized UTF-8 JSON bytes using `Buffer.byteLength`. This is not an end-to-end ChatGPT/token benchmark.

| Mode | Symbols returned | JSON bytes | Cold ms | Warm ms |
| --- | ---: | ---: | ---: | --- |
| Detailed | 384 | 83,314 | 1,480.4 | 1,336.9 / 1,286.2 / 1,269.2 |
| Outline | 49 | 3,537 | 168.2 | 133.0 / 159.4 / 169.9 |

For an **overview task** the reduced-depth response is ~95.8% smaller and ~8.4x quicker on warm average in this sample. This is intentionally **not equivalent information**: it omits child declarations and detailed location/previews. Keep `document_symbols` for exhaustive analysis, use `document_outline` for orientation, and paginate deeper calls as needed. Startup, network/MCP envelope and model token/call savings were not measured. No claim that replacing the detailed result always improves correctness.
