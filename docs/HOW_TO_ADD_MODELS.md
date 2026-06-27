# 🔌 How to Add and Use Local AI Models in OpenGravity IDE

OpenGravity features a dynamic, zero-configuration local model discovery engine. Instead of requiring manual code modification, the backend automatically queries your local Ollama instance at startup to detect, parse, and register any downloaded models.

---

## 🚀 Step 1: Download a Model via Ollama
Ensure you have [Ollama](https://ollama.com/) running locally. Pull any model you wish to use inside your system terminal:

```bash
# Example: Pulling Llama 3 or Mistral
ollama pull mistral
```

---

## 🔍 Step 2: Dynamic Model Discovery
At startup, the OpenGravity orchestrator queries `http://localhost:11434/api/tags` to dynamically read details like context length and tool capabilities. 

No code changes are required. The model will automatically register in the IDE with the model ID structure `opengravity/<model-name>` (e.g., `opengravity/mistral:latest`).

> [!NOTE]
> If you want to check the active registry or inspect local discovery logic, review the implementation in the Ollama provider file:
> [backend/src/gateway/providers/ollama.ts](file:///d:/open-antigravity-main/backend/src/gateway/providers/ollama.ts)

---

## ⚙️ Step 3: Configure settings.json in the IDE
To set your newly downloaded model as the active agent or assistant model in the editor, map it in your user configuration:

1. Open your VS Code `settings.json` file.
2. Map your model identifiers prefixed with the **`opengravity/`** namespace:

```json
{
    "chat.utilityModel": "opengravity/mistral:latest",
    "chat.utilitySmallModel": "opengravity/mistral:latest"
}
```

Now, when you trigger the chat sidebar or ask `@opengravity` a question, the IDE will route the execution context directly to your locally running model.
