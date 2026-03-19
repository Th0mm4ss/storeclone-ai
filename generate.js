export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  const { prompt, type } = await req.json();

  const systemPrompt = type === 'product_html'
    ? `Tu es un expert en création de produits digitaux premium pour Etsy. Tu génères des fichiers HTML interactifs complets et professionnels avec CSS inline élégant et JavaScript fonctionnel. Tu réponds UNIQUEMENT avec le code HTML complet, sans markdown, sans backticks, sans explication.`
    : `Tu es un expert Etsy et e-commerce. Tu réponds UNIQUEMENT en JSON valide sans markdown ni backticks.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: type === 'product_html' ? 4000 : 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
