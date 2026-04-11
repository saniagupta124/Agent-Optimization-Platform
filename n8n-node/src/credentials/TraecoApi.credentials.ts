import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class TraecoApi implements ICredentialType {
	name = 'traecoApi';
	displayName = 'Traeco API';
	documentationUrl = 'https://traeco.ai/docs/integrations/n8n';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'tk_live_...',
			description: 'Your Traeco API key. Generate one at traeco.ai → Settings → API Keys.',
		},
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'https://api.traeco.ai',
			description: 'Leave as default unless you are self-hosting Traeco.',
		},
	];
}
