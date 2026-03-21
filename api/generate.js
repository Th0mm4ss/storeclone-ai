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

  const { prompt, type, priceRange, tone, outputLang } = await req.json();

  let systemPrompt;
  if (type === 'product_html') {
    systemPrompt = `Tu es un expert en création de produits digitaux premium pour Etsy. Tu génères des fichiers HTML interactifs complets et professionnels avec CSS inline élégant et JavaScript fonctionnel. Tu réponds UNIQUEMENT avec le code HTML complet, sans markdown, sans backticks, sans explication.`;
  } else {
    systemPrompt = `Tu es un expert en e-commerce, SEO et copywriting pour les marketplaces (Etsy, Shopify, Gumroad). Tu génères des fiches produits digitaux qui se vendent.

Règles :
- Chaque titre doit être unique, accrocheur et contenir des mots-clés SEO pertinents
- Les descriptions doivent être persuasives, orientées bénéfices (pas features), et faire 80-100 mots
- Génère exactement 13 tags par produit, du plus spécifique au plus général
- Les prix doivent être réalistes pour le marché des produits digitaux
- Chaque produit doit être véritablement différent des autres (pas juste des variations du même concept)
- Les noms de produits doivent donner envie d'acheter immédiatement

Réponds UNIQUEMENT en JSON valide sans markdown ni backticks.`;
  }

  // Build user prompt, appending options if provided
  let fullPrompt = prompt;
  if (type !== 'product_html' && (priceRange || tone || outputLang)) {
    const extras = [];
    if (priceRange) extras.push(`Fourchette de prix: ${priceRange}`);
    if (tone) extras.push(`Ton: ${tone}`);
    if (outputLang && outputLang !== 'both') extras.push(`Langue de sortie: ${outputLang === 'fr' ? 'français uniquement' : 'anglais uniquement'}`);
    if (extras.length > 0) {
      fullPrompt += '\n\nContraintes supplémentaires:\n' + extras.join('\n');
    }
  }

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
      messages: [{ role: 'user', content: fullPrompt }]
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
