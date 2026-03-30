// Keep extraction prompt in sync with apps/agents/src/tools/ocr/extract-manifest.ts
import { NextRequest, NextResponse } from 'next/server';

const EXTRACTION_PROMPT = `Eres un sistema de extraccion de datos logisticos chilenos.

Analiza todas las paginas de este manifiesto de entrega y extrae cada orden con sus bultos.

Responde UNICAMENTE con JSON valido en este formato exacto:
{
  "delivery_date": "YYYY-MM-DD o null",
  "orders": [{
    "order_number": "string",
    "customer_name": "string o null",
    "customer_phone": "string o null",
    "delivery_address": "string o null",
    "comuna": "string o null",
    "packages": [{
      "label": "string",
      "package_number": "string o null",
      "declared_box_count": 1,
      "sku_items": [{"sku": "string", "description": "string", "quantity": 1}],
      "declared_weight_kg": null
    }]
  }]
}

Reglas:
- Extrae TODAS las ordenes visibles en todas las paginas
- Si un campo no es visible o legible, usa null
- Los numeros de telefono chilenos: +56 9 XXXX XXXX
- No inventes datos que no esten en el manifiesto
- Si el manifiesto es ilegible, responde: {"orders": [], "error": "ilegible"}`;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY not configured on this server' },
      { status: 500 },
    );
  }

  const formData = await req.formData();
  const images = formData.getAll('images').filter((v): v is File => v instanceof File);

  if (images.length === 0) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 });
  }

  const imageContents = await Promise.all(
    images.map(async (file) => {
      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString('base64');
      return {
        type: 'image_url' as const,
        image_url: { url: `data:${file.type};base64,${base64}` },
      };
    }),
  );

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [...imageContents, { type: 'text', text: EXTRACTION_PROMPT }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return NextResponse.json(
      { error: `OpenRouter error ${response.status}`, detail: body },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  let text = data.choices[0]?.message?.content?.trim() ?? '';
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const result = JSON.parse(text) as unknown;
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Model returned non-JSON', raw: text }, { status: 502 });
  }
}
