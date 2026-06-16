# VS Code Custom Workbench & OpenGravity Build 

This document maps the entire process of installing dependencies, patching upstream build scripts, resolving compiler & MIME type errors, and launching the custom VS Code Electron IDE with OpenGravity.

---

## ⚡ Quick Start: How to Run the Project

To start development or test the integration, run the following components in separate terminal windows:

### 1. Start the Backend Orchestrator (`newcore`)
Navigate to the `newcore` directory and start the local AI orchestrator:
```powershell
cd d:\open-antigravity-main\newcore
npm run dev
```
*(This spawns the API server on port `3777` using the `mock` model engine, so no external LLM API keys are required.)*

### 2. Launch the Custom VS Code Electron IDE
Set the development environment variables and run the Electron binary:
```powershell
# Set dev flags so CSS import maps and dev tools load correctly
$env:NODE_ENV = "development"
$env:VSCODE_DEV = "1"
$env:VSCODE_CLI = "1"

# Launch the Electron binary
& "D:\open-antigravity-main\vscode-main\.build\electron\Code - OSS.exe" "D:\open-antigravity-main\vscode-main"
```

### 3. Compilation & Watching (Optional)
If you make changes to the VS Code client code, run:
* **Recompile Client**:
  ```powershell
  cd d:\open-antigravity-main\vscode-main
  npm run compile
  ```
* **Run Watch Mode**:
  ```powershell
  cd d:\open-antigravity-main\vscode-main
  npm run watch
  ```

---

## 🛠️ Stage-by-Step Technical Breakdown
---

### Stage 2: Installation Lifecycle Script Patches
To bypass environment checks that crash the setup lifecycle outside the official repository CI, we patched two lifecycle scripts:

#### 1. `build/npm/preinstall.ts`
* **File Directory**: `vscode-main/build/npm/preinstall.ts`
* **Path**: [preinstall.ts](file:///d:/open-antigravity-main/vscode-main/build/npm/preinstall.ts)
* **The "Why"**: The preinstall check invokes npm commands during Electron header builds. Under certain npm configurations, `process.env.npm_command` resolves to `'exec'`, leading to infinite recursion (`npm exec` nested loops) that hangs the install process.
* **Code Change**:
```diff
-	const cmd = process.env.npm_command || 'ci';
+	const cmd = (process.env.npm_command && process.env.npm_command !== 'exec') ? process.env.npm_command : 'ci';
```

#### 2. `build/npm/postinstall.ts`
* **File Directory**: `vscode-main/build/npm/postinstall.ts`
* **Path**: [postinstall.ts](file:///d:/open-antigravity-main/vscode-main/build/npm/postinstall.ts)
* **The "Why"**: The upstream repository runs global `git config` operations during `postinstall`. Because our workspace is parsed outside a git clone metadata directory (no `.git` folder exists), `git config` throws a fatal execution exception and crashes the dependency script.
* **Code Change**:
```diff
-	child_process.execSync('git config pull.rebase merges');
-	child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
+	try { child_process.execSync('git config pull.rebase merges'); } catch {}
+	try { child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs'); } catch {}
```

---

### Stage 3: Copilot ESM Compilation Fix
* **File Directory**: `vscode-main/extensions/copilot/.esbuild.mts`
* **Path**: [.esbuild.mts](file:///d:/open-antigravity-main/vscode-main/extensions/copilot/.esbuild.mts)
* **The "Why"**: Under Node 22/24's strict ES Module (ESM) resolution engine, default imports from a CommonJS module that doesn't expose a default export throw `ERR_UNKNOWN_FILE_EXTENSION` or module linkage errors during the esbuild process. The `glob` library is standard CommonJS with named exports only.
* **Code Change**:
```diff
-import glob from 'glob';
+import { glob } from 'glob';
```

---

### Stage 4: OpenGravity Extension Desktop Integration
* **File Directory**: `vscode-main/extensions/opengravity/package.json`
* **Path**: [package.json](file:///d:/open-antigravity-main/vscode-main/extensions/opengravity/package.json)
* **The "Why"**: The OpenGravity integration was configured only for `"web"` runtimes (`extensionKind: ["web"]`). When launching a native desktop Electron process, VS Code ignores any extensions that do not state support for local environments, meaning the extension remained unparsed.
* **Code Change**:
```diff
 {
   "name": "opengravity",
   ...
-  "extensionKind": ["web"],
+  "extensionKind": ["ui", "workspace"],
+  "main": "./dist/node/extension.js",
   "browser": "./dist/browser/extension.js",
   ...
 }
```

---

### Stage 5: Gulp Client Assets Compilation
* **Action**: Ran the compiler after resolving typescript types:
  ```powershell
  npm run compile
  ```
* **Result**: Compiled the source files into the client destination directory (`out/`) without errors.

---

### Stage 6: MIME Type Error & Blank Screen Resolution
* **The Problem**: Spawning `Code - OSS.exe` resulted in a blank window. Checking the Chromium logs (`launch.err.log`) showed:
  > Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/css"
* **The "Why"**: Chrome blocks raw CSS files dynamically imported as scripts (`import './file.css'`). VS Code relies on `cssDevelopmentService` to parse CSS assets into dynamic JS Blobs using **CSS Import Maps**. However, this service only runs if the environment tells VS Code it is a development run. Without the development flags, the service was bypassed and Chrome crashed loading raw CSS.
* **The Fix**: Pre-configured development environment variables before spawning:
  ```powershell
  $env:NODE_ENV = "development"
  $env:VSCODE_DEV = "1"
  $env:VSCODE_CLI = "1"
  ```
* **Command**:
  ```powershell
  & "D:\open-antigravity-main\vscode-main\.build\electron\Code - OSS.exe" "D:\open-antigravity-main\vscode-main" --disable-extension=vscode.vscode-api-tests
  ```

---

### Stage 7: Integrated Terminal Crash Resolution
* **The Problem**: Opening the terminal within the IDE threw a native exception: `Cannot find conpty.dll`.
* **The "Why"**: The underlying `node-pty` package manages terminal pseudo-TTY interfaces using the Windows Console API (`conpty`). The IDE expected the pre-compiled `conpty.dll` and `OpenConsole.exe` binaries to be located inside its built release folder (`build\Release\conpty\`), but they were missing from that directory after the build.
* **The Fix**: Copied the pre-built binaries provided in the repository's third-party dependencies directory (`third_party\conpty\1.25.260303002\win10-x64\`) directly to the target `build\Release\conpty\` folder where the terminal module dynamically loads them.

---

## 🔍 OpenGravity Integration Architecture & Folder Structure

In interviews, if they ask **how** the IDE integrates with OpenGravity and **which folders** are used, you can explain it using this structure:

### 1. Key Folders Involved
* **`vscode-main/extensions/opengravity/`**: The root directory for the bridge extension.
* **`vscode-main/extensions/opengravity/src/`**: Contains the TypeScript source code of the extension.
  - Registers the participant using `vscode.chat.createChatParticipant`.
  - Connects to the local OpenGravity agent orchestrator (running on a local port or custom SSE endpoint) to forward user prompts and stream back response tokens in real-time.
* **`vscode-main/extensions/opengravity/dist/`**: The output directory for compiled code.
  - **`dist/node/extension.js`**: Native desktop entry point loaded by Electron.
  - **`dist/browser/extension.js`**: Web entry point loaded in browser/web sessions.

### 2. VS Code Extension API Integration Mechanism
The integration occurs at the **VS Code Extension Host** layer using proposed platform APIs:

1. **Proposed APIs**: Enabled in `package.json` under `"enabledApiProposals"`:
   - `chatProvider`: Allows the extension to register as a system-wide LLM vendor.
   - `languageModelSystem`: Exposes the local models so other extensions can query them.
2. **Chat Participant Contribution**: Registered in `package.json` under the `"contributes"` section:
   - Registers a participant named `@opengravity` (ID: `opengravity.default`) with modes `ask`, `agent`, and `edit`.
   - When a user types `@opengravity` in the Copilot Chat Sidebar, VS Code routes the prompt event to this extension's handler.
3. **Language Model Chat Provider**:
   - Registers a provider under vendor `"customendpoint"` and model name `"OpenGravity"`.
   - VS Code's internal language model selector binds this vendor to the model list, letting you choose OpenGravity as the active model in the Copilot interface.

---

## 💬 Interview Quick-Reference: The "Why" Cheat Sheet


| Question | Technical Core ("The Why") |
|---|---|
| **Why custom install MSVC on D?** | Drive C was out of storage space. Redirected paths using `--installPath`, `--path shared`, and `--path cache` arguments. |
| **Why include Spectre runtimes?** | Native extensions (`native-keymap`) compile with `/Qspectre` mitigations enabled. Linker crashes without the Spectre-mitigated system runtimes. |
| **Why patch preinstall execution?** | Prevent recursion where `process.env.npm_command` resolves to `'exec'`, creating nested npm hangs. |
| **Why add try-catch in postinstall?** | git configuration commands crash when run inside folders lacking a `.git` metadata repository context. |
| **Why change `glob` import signature?** | Modern Node ESM runtimes restrict default importing of CJS modules that only declare named exports. Changed to named import syntax `{ glob }`. |
| **Why did the workbench start blank?** | Chromium blocks scripts fetched with a MIME type of `"text/css"`. `VSCODE_DEV` environment variable must be `1` to enable `cssDevelopmentService` which resolves this via dynamic Blobs. |
| **Why change `extensionKind`?** | Desktop Electron excludes extensions tagged only for the web runtime. Updated to `["ui", "workspace"]` to enable native loading. |
| **Why did the terminal crash with missing `conpty.dll`?** | The `node-pty` module relies on the Windows Pseudo Console API (`conpty.dll`). The compiled release directory missed these binaries. We resolved this by manually copying the pre-compiled `win10-x64` binaries into the expected `build/Release/conpty/` path. |
