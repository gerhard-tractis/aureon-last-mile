// src/tools/whatsapp/send-message.ts — WhatsApp Business API message sender
import { log } from '../../lib/logger';

const WA_API_VERSION = 'v18.0';
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;

export interface WaSendResult {
  external_message_id: string;
}

export interface WaTextPayload {
  type: 'text';
  to: string;
  body: string;
}

export interface WaTemplatePayload {
  type: 'template';
  to: string;
  template_name: string;
  language_code: string;
  components?: unknown[];
}

export type WaMessagePayload = WaTextPayload | WaTemplatePayload;

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  payload: WaMessagePayload,
): Promise<WaSendResult> {
  const body =
    payload.type === 'text'
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: payload.to,
          type: 'text',
          text: { body: payload.body },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: payload.to,
          type: 'template',
          template: {
            name: payload.template_name,
            language: { code: payload.language_code },
            ...(payload.components ? { components: payload.components } : {}),
          },
        };

  const response = await fetch(`${WA_BASE_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    log('error', 'wa_send_failed', { to: payload.to, status: response.status, body: text });
    throw new Error(`WhatsApp API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as { messages?: Array<{ id: string }> };
  const messageId = json.messages?.[0]?.id ?? '';
  log('info', 'wa_message_sent', { to: payload.to, messageId });
  return { external_message_id: messageId };
}
