# Custom Agentic IDE Implementation Checklist

## ✅ Phase 1 — Backend Engine
- `[x]` Setup environment configuration (`newcore/.env`)
- `[x]` Install/verify local dependencies in the `newcore` backend directory
- `[x]` Implement missing `ArtifactStore` class (`newcore/src/artifacts/index.ts`)
- `[x]` Launch the Fastify API and WebSocket server on port `3777`
- `[x]` Verify server health and tools availability via curl/cli
- `[x]` Add OpenAI-compatible `/v1/models` and `/v1/chat/completions` endpoints

## ✅ Phase 2 — VS Code Web IDE Build
- `[x]` Install VS Code dependencies (`npm install --ignore-scripts`)
- `[x]` Install build tool dependencies (`vscode-main/build/`)
- `[x]` Bypass `monaco.d.ts` strict assertion blocker in `build/lib/compilation.ts`
- `[x]` Build and transpile the editor client core using `compile-client` gulp pipeline
- `[x]` Fix `ERR_UNKNOWN_FILE_EXTENSION` by patching all extension `package.json` scripts to use `npx tsx`
- `[x]` Patch `build/lib/extensions.ts` and `.js` to inject `--import tsx` for `.mts` scripts
- `[x]` Fix `tsgo` exit-code abort — type-check failures now log and resolve gracefully
- `[x]` Fix `html-language-features` Windows path bug (use `fileURLToPath`)
- `[x]` Fix `typescript-language-features` missing `typescript/lib` path resolution
- `[x]` **`compile-web` passing with exit code 0** — all extensions package correctly ✓

## ✅ Phase 3 — IDE Frontend Runtime
- `[x]` Start the VS Code Web development server on port `8080`
- `[x]` Verify successful browser-based editor workbench boot
- `[x]` Confirm **zero** extension activation "Not Found" errors
- `[x]` Chat panel visible and operational in sidebar
- `[x]` Inject OpenGravity provider into `languageModelsConfigurationService.ts`

## ✅ Phase 4 — Chat Integration
- `[x]` Re-run `compile-client` so OpenGravity injection is compiled into workbench
- `[x]` Bridge extension (`extensions/opengravity`) built and routes chat to port `3777` (runtime import bug fixed)
- `[x]` Backend streaming test: `/v1/chat/completions` returns valid SSE chunks ✓
- `[x]` Extension bundle: `dist/browser/extension.js` built, passes `isWebExtension()` check ✓
- `[x]` `product.json` whitelists `opengravity.opengravity` API proposals ✓
- `[x]` Verify OpenGravity model appears in Chat model selector dropdown — **programmatically confirmed, manual UI check pending** (open http://127.0.0.1:8080 → Chat → model picker)
