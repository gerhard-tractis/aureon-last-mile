// src/providers/glm-ocr.ts — GLM-OCR document vision provider (custom HTTP API)

export interface GlmOcrResponse {
  text: string;
  confidence: number;
  fields?: Record<string, string>;
}

export interface GlmOcrError {
  type: 'api_error' | 'timeout';
  message: string;
}

const TIMEOUT_MS = 30000;

function makeGlmError(type: GlmOcrError['type'], message: string): GlmOcrError & Error {
  const err = new Error(message) as GlmOcrError & Error;
  err.type = type;
  return err;
}

export class GlmOcrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
  ) {}

  async extractDocument(
    imageBase64: string,
    prompt?: string,
  ): Promise<GlmOcrResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const body: Record<string, unknown> = { image: imageBase64 };
    if (prompt !== undefined) {
      body.prompt = prompt;
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw makeGlmError('timeout', `GLM-OCR request timed out after ${TIMEOUT_MS}ms`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw makeGlmError('api_error', message);
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw makeGlmError(
        'api_error',
        `GLM-OCR API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json() as GlmOcrResponse;
    return {
      text: data.text,
      confidence: data.confidence,
      ...(data.fields !== undefined && { fields: data.fields }),
    };
  }
}
