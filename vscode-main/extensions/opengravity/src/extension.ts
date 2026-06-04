/*---------------------------------------------------------------------------------------------
 * OpenGravity IDE — Browser Extension Entry Point
 * Registers the OpenGravity language model chat provider, routing all chat completions
 * through the local orchestrator engine at http://127.0.0.1:3777.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// ─── Configuration ────────────────────────────────────────────────────────────
const OPENGRAVITY_VENDOR = 'customendpoint';
const OPENGRAVITY_API_BASE = 'http://127.0.0.1:3777/v1';
const DEFAULT_MODEL_ID = 'opengravity-default';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert VS Code chat messages to OpenAI message format */
function toOpenAIMessages(
	messages: vscode.LanguageModelChatMessage2[]
): { role: string; content: string }[] {
	return messages.map(msg => {
		let role: string;
		// LanguageModelChatMessageRole: User=1, Assistant=2, System=3
		switch ((msg.role as unknown as number)) {
			case 1: role = 'user'; break;
			case 2: role = 'assistant'; break;
			case 3: role = 'system'; break;
			default: role = 'user';
		}

		// Content can be a string or array of content parts
		let content = '';
		if (typeof msg.content === 'string') {
			content = msg.content;
		} else if (Array.isArray(msg.content)) {
			content = msg.content
				.map((p: any) => (typeof p === 'string' ? p : p.value ?? ''))
				.join('');
		}
		return { role, content };
	});
}

// ─── Provider ─────────────────────────────────────────────────────────────────

class OpenGravityModelProvider implements vscode.LanguageModelChatProvider {

	async provideLanguageModelChatInformation(
		_options: { silent: boolean; configuration?: Record<string, unknown> },
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		// Fetch available models from our backend
		let models: { id: string; name?: string }[] = [];
		try {
			const res = await fetch(`${OPENGRAVITY_API_BASE}/models`, { signal: AbortSignal.timeout(3000) });
			if (res.ok) {
				const json = await res.json() as { data?: Array<{ id: string }>; models?: Array<{ id: string }> };
				const raw = json.data ?? json.models ?? [];
				models = raw.map(m => ({ id: m.id ?? DEFAULT_MODEL_ID }));
			}
		} catch {
			// Backend unreachable — expose a placeholder so the user sees something
		}

		if (models.length === 0) {
			models = [{ id: DEFAULT_MODEL_ID, name: 'OpenGravity (Local)' }];
		}

		return models.map(m => ({
			id: m.id,
			name: m.name ?? m.id,
			family: 'opengravity',
			version: '1.0',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			capabilities: {
				imageInput: false,
				toolCalling: true,
			}
		}));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.LanguageModelChatRequestOptions & { modelConfiguration?: Record<string, unknown> },
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const controller = new AbortController();
		const cancelDisposable = token.onCancellationRequested(() => controller.abort());

		try {
			const body = JSON.stringify({
				model: model.id,
				messages: toOpenAIMessages(messages),
				stream: true,
				max_tokens: (options as any).maxTokens ?? 4096,
				temperature: (options as any).temperature ?? 0.7,
			});

			const response = await fetch(`${OPENGRAVITY_API_BASE}/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
				body,
				signal: controller.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`OpenGravity API error ${response.status}: ${errText}`);
			}

			if (!response.body) {
				throw new Error('OpenGravity API returned no body');
			}

			// ── SSE streaming decoder ──────────────────────────────────────────
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				if (token.isCancellationRequested) { break; }

				const { done, value } = await reader.read();
				if (done) { break; }

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';   // keep incomplete last line

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data:')) { continue; }
					const data = trimmed.slice(5).trim();
					if (data === '[DONE]') { return; }

					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{ delta?: { content?: string; role?: string } }>;
						};
						const delta = parsed.choices?.[0]?.delta;
						if (delta?.content) {
							progress.report(new (vscode as any).LanguageModelTextPart(delta.content));
						}
					} catch {
						// malformed SSE chunk — skip
					}
				}
			}
		} finally {
			cancelDisposable.dispose();
		}
	}

	provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		_text: string | vscode.LanguageModelChatMessage2,
		_token: vscode.CancellationToken
	): number | Thenable<number> {
		// Simple approximation: 1 token ≈ 4 chars
		const str = typeof _text === 'string' ? _text : JSON.stringify(_text);
		return Math.ceil(str.length / 4);
	}
}

// ─── Activation ───────────────────────────────────────────────────────────────

function registerOpenGravityParticipant(context: vscode.ExtensionContext): void {
	const participant = vscode.chat.createChatParticipant('opengravity.default', async (
		request: vscode.ChatRequest,
		_context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	) => {
		const modelResponse = await request.model.sendRequest([
			vscode.LanguageModelChatMessage.User(request.prompt),
		], {}, token);
 
		for await (const chunk of modelResponse.text) {
			if (token.isCancellationRequested) {
				break;
			}
			response.markdown(chunk);
		}
	});
 
	participant.iconPath = new vscode.ThemeIcon('sparkle');
	context.subscriptions.push(participant);
}

export function activate(context: vscode.ExtensionContext): void {
	const provider = new OpenGravityModelProvider();

	try {
		const disposable = vscode.lm.registerLanguageModelChatProvider(
			OPENGRAVITY_VENDOR,
			provider
		);
		context.subscriptions.push(disposable);
		console.log('[OpenGravity] Language model provider registered successfully.');
	} catch (e) {
		console.error('[OpenGravity] Failed to register language model provider (perhaps already registered):', e);
	}

	try {
		registerOpenGravityParticipant(context);
		console.log('[OpenGravity] Chat participant registered successfully.');
	} catch (e) {
		console.error('[OpenGravity] Failed to register chat participant:', e);
	}

	console.log('[OpenGravity] Extension activated — routing chat to', OPENGRAVITY_API_BASE);
}

export function deactivate(): void {
	console.log('[OpenGravity] Extension deactivated');
}
