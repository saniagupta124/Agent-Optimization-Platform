import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

export class Traeco implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Traeco',
		name: 'traeco',
		icon: 'file:traeco.svg',
		group: ['transform'],
		version: 1,
		description:
			'Track LLM token usage and costs with Traeco. Place after any OpenAI, Anthropic, or other LLM node.',
		defaults: {
			name: 'Traeco',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'traecoApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Agent Name',
				name: 'agentName',
				type: 'string',
				default: 'My n8n Agent',
				required: true,
				description: 'Name of the agent this workflow belongs to (groups all costs together in Traeco)',
			},
			{
				displayName: 'Step Name',
				name: 'stepName',
				type: 'string',
				default: '={{ $node.name }}',
				required: true,
				description:
					'Name of this step/function in your agent (defaults to the previous node name). Used for per-function cost breakdown.',
			},
			{
				displayName: 'Provider',
				name: 'provider',
				type: 'options',
				options: [
					{ name: 'OpenAI', value: 'openai' },
					{ name: 'Anthropic', value: 'anthropic' },
					{ name: 'Google', value: 'google' },
					{ name: 'Other', value: 'other' },
				],
				default: 'openai',
				required: true,
			},
			{
				displayName: 'Token Usage Mapping',
				name: 'tokenMapping',
				type: 'fixedCollection',
				default: {},
				description: 'Map the token fields from the previous node output. Leave blank to auto-detect.',
				options: [
					{
						name: 'fields',
						displayName: 'Fields',
						values: [
							{
								displayName: 'Prompt Tokens Field',
								name: 'promptTokensField',
								type: 'string',
								default: '',
								placeholder: 'e.g. usage.prompt_tokens or inputTokens',
								description: 'JSON path to prompt token count in the previous node output',
							},
							{
								displayName: 'Completion Tokens Field',
								name: 'completionTokensField',
								type: 'string',
								default: '',
								placeholder: 'e.g. usage.completion_tokens or outputTokens',
								description: 'JSON path to completion token count in the previous node output',
							},
							{
								displayName: 'Model Field',
								name: 'modelField',
								type: 'string',
								default: '',
								placeholder: 'e.g. model',
								description: 'JSON path to model name in the previous node output',
							},
						],
					},
				],
			},
			{
				displayName: 'Model Override',
				name: 'modelOverride',
				type: 'string',
				default: '',
				placeholder: 'e.g. gpt-4o, claude-3-5-sonnet',
				description:
					'Hardcode the model name if auto-detection fails. Only needed if the previous node does not include the model in its output.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = await this.getCredentials('traecoApi');
		const apiKey = credentials.apiKey as string;
		const host = (credentials.host as string) || 'https://api.traeco.ai';

		const agentName = this.getNodeParameter('agentName', 0) as string;
		const stepName = this.getNodeParameter('stepName', 0) as string;
		const provider = this.getNodeParameter('provider', 0) as string;
		const modelOverride = this.getNodeParameter('modelOverride', 0) as string;
		const tokenMapping = this.getNodeParameter('tokenMapping', 0) as {
			fields?: {
				promptTokensField?: string;
				completionTokensField?: string;
				modelField?: string;
			};
		};

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const data = item.json;

			let promptTokens = 0;
			let completionTokens = 0;
			let model = modelOverride || '';

			// Try custom field paths first
			const mapping = tokenMapping.fields || {};
			if (mapping.promptTokensField) {
				promptTokens = getNestedValue(data, mapping.promptTokensField) ?? 0;
			}
			if (mapping.completionTokensField) {
				completionTokens = getNestedValue(data, mapping.completionTokensField) ?? 0;
			}
			if (mapping.modelField) {
				model = getNestedValue(data, mapping.modelField) ?? model;
			}

			// Auto-detect from common provider response shapes if not mapped
			if (!promptTokens && !completionTokens) {
				const detected = autoDetectUsage(data, provider);
				promptTokens = detected.promptTokens;
				completionTokens = detected.completionTokens;
				model = model || detected.model;
			}

			model = model || fallbackModel(provider);

			const startTime = item.pairedItem ? Date.now() : Date.now();
			const latencyMs = 0; // n8n doesn't expose per-node timing; set 0

			// Fire-and-forget — never block the workflow
			sendTrace({
				host,
				apiKey,
				agentName,
				stepName,
				provider,
				model,
				promptTokens,
				completionTokens,
				latencyMs,
			}).catch(() => {
				// Intentionally silent — tracing must never break the workflow
			});
		}

		// Always pass data through unchanged
		return [items];
	}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	return path.split('.').reduce((acc: unknown, key) => {
		if (acc && typeof acc === 'object') {
			return (acc as Record<string, unknown>)[key];
		}
		return undefined;
	}, obj);
}

function autoDetectUsage(
	data: Record<string, unknown>,
	provider: string,
): { promptTokens: number; completionTokens: number; model: string } {
	let promptTokens = 0;
	let completionTokens = 0;
	let model = '';

	// OpenAI format: { usage: { prompt_tokens, completion_tokens }, model }
	if (data.usage && typeof data.usage === 'object') {
		const usage = data.usage as Record<string, unknown>;
		promptTokens = (usage.prompt_tokens as number) || 0;
		completionTokens = (usage.completion_tokens as number) || 0;
	}

	// Anthropic format: { usage: { input_tokens, output_tokens }, model }
	if (data.usage && typeof data.usage === 'object') {
		const usage = data.usage as Record<string, unknown>;
		if (!promptTokens) promptTokens = (usage.input_tokens as number) || 0;
		if (!completionTokens) completionTokens = (usage.output_tokens as number) || 0;
	}

	// n8n OpenAI node wraps response: { message, tokenUsage: { completionTokens, promptTokens } }
	if (data.tokenUsage && typeof data.tokenUsage === 'object') {
		const tu = data.tokenUsage as Record<string, unknown>;
		promptTokens = (tu.promptTokens as number) || promptTokens;
		completionTokens = (tu.completionTokens as number) || completionTokens;
	}

	// Google/Gemini format: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
	if (data.usageMetadata && typeof data.usageMetadata === 'object') {
		const um = data.usageMetadata as Record<string, unknown>;
		promptTokens = (um.promptTokenCount as number) || promptTokens;
		completionTokens = (um.candidatesTokenCount as number) || completionTokens;
	}

	model = (data.model as string) || '';

	return { promptTokens, completionTokens, model };
}

function fallbackModel(provider: string): string {
	const defaults: Record<string, string> = {
		openai: 'gpt-4o',
		anthropic: 'claude-3-5-sonnet',
		google: 'gemini-pro',
		other: 'unknown',
	};
	return defaults[provider] || 'unknown';
}

async function sendTrace(params: {
	host: string;
	apiKey: string;
	agentName: string;
	stepName: string;
	provider: string;
	model: string;
	promptTokens: number;
	completionTokens: number;
	latencyMs: number;
}): Promise<void> {
	const { host, apiKey, agentName, stepName, provider, model, promptTokens, completionTokens, latencyMs } =
		params;

	const response = await fetch(`${host}/ingest`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Traeco-Key': apiKey,
		},
		body: JSON.stringify({
			agent_name: agentName,
			provider,
			model,
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			latency_ms: latencyMs,
			feature_tag: stepName,
			status: 'success',
		}),
	});

	if (!response.ok) {
		throw new Error(`Traeco ingest failed: ${response.status}`);
	}
}
