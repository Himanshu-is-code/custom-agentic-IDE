# Goal: Stabilize OpenGravity Chat Integration & Resolve Provider Conflicts

Resolve the "opengravity doesnt show inside window" issue by moving the OpenGravity extension's registered provider to a dedicated `opengravity` vendor, avoiding conflict with the Copilot extension's native `customendpoint` provider.

## User Review Required

> [!IMPORTANT]
> **Unique Vendor Identifier**
> By default, the OpenGravity extension used `customendpoint` as its vendor. Since the built-in Copilot extension also registers `customendpoint` for its Bring-Your-Own-Key (BYOK) custom endpoint functionality, this causes a registration conflict at startup, preventing OpenGravity from appearing in the UI. 
> We will change OpenGravity's vendor to `opengravity`, allowing both providers to coexist cleanly.

## Proposed Changes

### Extension Subsystem

#### [MODIFY] [package.json](file:///d:/open-antigravity-main/vscode-main/extensions/opengravity/package.json)
- Change `"vendor": "customendpoint"` to `"vendor": "opengravity"`.

#### [MODIFY] [extension.ts](file:///d:/open-antigravity-main/vscode-main/extensions/opengravity/src/extension.ts)
- Update `OPENGRAVITY_VENDOR` from `'customendpoint'` to `'opengravity'`.

### Main Workbench Subsystem

#### [MODIFY] [languageModelsConfigurationService.ts](file:///d:/open-antigravity-main/vscode-main/src/vs/workbench/contrib/chat/browser/languageModelsConfigurationService.ts)
- Update the default provider group vendor from `'customendpoint'` to `'opengravity'` to ensure the OpenGravity provider group aligns with our new vendor.

---

## Verification Plan

### Automated/System Tests
1. Compile the opengravity extension: `npm run compile` in `vscode-main/extensions/opengravity`.
2. Confirm the client builds and transpiles without errors.

### Manual Verification
1. Launch the custom VS Code Electron IDE.
2. Open the Chat panel.
3. Verify that the model picker dropdown correctly lists `OpenGravity` / `OpenGravity (Local)`.
4. Test the model to ensure it communicates correctly with the backend orchestrator on port 3777.
