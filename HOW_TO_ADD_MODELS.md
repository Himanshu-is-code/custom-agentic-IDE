# How to Add and Use New AI Models in OpenGravity IDE

This guide outlines the steps to add and use new local AI models (such as those downloaded via Ollama) in your OpenGravity IDE environment.

---

## Step 1: Download the Model via Ollama
Open your system terminal and pull/download the model you want to add:
```powershell
ollama pull mistral
```

---

## Step 2: Register the Model in the IDE Backend Codebase
The IDE's core orchestrator manages model metadata (context window, tool support, cost, etc.) via a static registry to ensure compatibility.

1. Open [newcore/src/gateway/providers/ollama.ts](file:///d:/open-antigravity-main/newcore/src/gateway/providers/ollama.ts).
2. Add the metadata of your new model into the `models` list under the `OllamaProvider` class:
   ```typescript
   readonly models: ModelInfo[] = [
     // ... existing models ...
     { 
       id: 'mistral', 
       provider: 'ollama', 
       name: 'Mistral (Local)', 
       contextWindow: 8192, 
       maxOutputTokens: 4096, 
       supportsTools: false, 
       supportsStreaming: true, 
       costPerInputToken: 0, 
       costPerOutputToken: 0 
     },
   ];
   ```

---

## Step 3: Configure settings.json in the IDE
Once the model is registered in the backend, you can specify it in your user settings:

1. Open your VS Code `settings.json` file.
2. Map your utility models to the registered model identifier prefixed with the **`opengravity/`** namespace:
   ```json
   {
       "chat.utilityModel": "opengravity/codellama",
       "chat.utilitySmallModel": "opengravity/mistral"
   }
   ```
