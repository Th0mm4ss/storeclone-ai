// Node.js serverless runtime (supports longer execution)
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL = 'https://hbaaqukxtoqxaxcbqmkj.supabase.co';
const PLAN_LIMITS = { starter: 3, pro: 30, business: Infinity };

// ─── Server-side quota check ──────────────────────────────────────────────────
async function checkServerQuota(userToken) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !userToken) return { ok: true };
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': serviceKey }
    });
    if (!userRes.ok) return { ok: true };
    const userData = await userRes.json();
    const userId = userData?.id;
    if (!userId) return { ok: true };

    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=plan`, {
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey }
    });
    const subData = await subRes.json();
    const plan = subData?.[0]?.plan || 'starter';
    const limit = PLAN_LIMITS[plan] ?? 3;
    if (limit === Infinity) return { ok: true };

    const now = new Date();
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/generations?user_id=eq.${userId}&created_at=gte.${firstOfMonth}&select=id`,
      { headers: { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }
    );
    const total = parseInt((countRes.headers.get('content-range') || '0-0/0').split('/')[1], 10);
    if (total >= limit) {
      return { ok: false, message: `Quota mensuel atteint (${total}/${limit}). Veuillez passer à l'offre supérieure.` };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[quota] check error (non-blocking):', err.message);
    return { ok: true };
  }
}

// ─── System prompt — Métadonnées ──────────────────────────────────────────────
const SYSTEM_META = `Tu es un expert en stratégie de produits digitaux et SEO pour Etsy, Gumroad et Shopify.
Tu génères les métadonnées pour 3 produits digitaux HTML qui seront ensuite créés séparément.

RÈGLES ABSOLUES :
- Les 3 produits DOIVENT être de TYPES DIFFÉRENTS parmi : TRACKER, WORKBOOK, DASHBOARD, TEMPLATE
  (pas 3 trackers, pas 3 planners — 3 types d'outils vraiment différents)
- Chaque produit répond à un besoin DIFFÉRENT dans la niche
- Noms premium et accrocheurs (pas génériques)
- Descriptions 80-100 mots, orientées bénéfices (pas features)
- 13 tags par produit, du plus spécifique au plus général, optimisés Etsy
- Prix réalistes pour produits digitaux (5€-35€)
- Couleurs HEX différentes et adaptées à chaque produit (pas la même couleur pour tous)

Réponds UNIQUEMENT en JSON valide sans markdown ni backticks :
{"boutique":"Nom de marque accrocheur","products":[{"name":"Nom FR premium","nameEn":"English name","type":"TRACKER|WORKBOOK|DASHBOARD|TEMPLATE","description":"Description FR 80-100 mots orientée bénéfices","descriptionEn":"English description 80-100 words","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13"],"tagsEn":["tag1","tag2","tag3","tag4","tag5"],"price":"14.99","color":"#hexcolor","emoji":"emoji","features":["feature1","feature2","feature3","feature4"]},{"name":"...","nameEn":"...","type":"...","description":"...","descriptionEn":"...","tags":[],"tagsEn":[],"price":"","color":"","emoji":"","features":[]},{"name":"...","nameEn":"...","type":"...","description":"...","descriptionEn":"...","tags":[],"tagsEn":[],"price":"","color":"","emoji":"","features":[]}]}`;

// ─── System prompt — HTML (avec template de référence) ────────────────────────
const SYSTEM_HTML = `Tu es un designer UI/UX expert. Tu crées des fichiers HTML autonomes d'une qualité visuelle exceptionnelle. Chaque fichier doit ressembler à une mini-application web premium, pas à un document.

TEMPLATE DE RÉFÉRENCE — Utilise ce style comme base et adapte-le au produit :

<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{TITRE}}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --primary: #6366f1;
  --primary-light: #818cf8;
  --primary-bg: #eef2ff;
  --success: #22c55e;
  --success-bg: #f0fdf4;
  --warning: #f59e0b;
  --warning-bg: #fffbeb;
  --danger: #ef4444;
  --bg: #fafafa;
  --card: #ffffff;
  --text: #1e293b;
  --text-light: #64748b;
  --border: #e2e8f0;
  --radius: 16px;
  --shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06);
  --shadow-lg: 0 4px 6px rgba(0,0,0,0.04), 0 10px 24px rgba(0,0,0,0.08);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
.container { max-width: 900px; margin: 0 auto; padding: 24px; }
.header { text-align: center; padding: 48px 0 32px; }
.header h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 8px; }
.header p { color: var(--text-light); font-size: 15px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; margin-bottom: 20px; box-shadow: var(--shadow); transition: box-shadow 0.2s; }
.card:hover { box-shadow: var(--shadow-lg); }
.card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
.badge { display: inline-flex; padding: 4px 12px; border-radius: 100px; font-size: 12px; font-weight: 600; }
.badge-primary { background: var(--primary-bg); color: var(--primary); }
.badge-success { background: var(--success-bg); color: var(--success); }
.progress-bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin: 12px 0; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary), var(--primary-light)); border-radius: 4px; transition: width 0.5s ease; }
.checkbox-item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; cursor: pointer; transition: background 0.15s; }
.checkbox-item:hover { background: var(--bg); }
.checkbox-item input[type="checkbox"] { width: 20px; height: 20px; accent-color: var(--primary); cursor: pointer; }
.checkbox-item.done label { text-decoration: line-through; color: var(--text-light); }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.stat-card { text-align: center; padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
.stat-value { font-size: 32px; font-weight: 700; color: var(--primary); }
.stat-label { font-size: 13px; color: var(--text-light); margin-top: 4px; }
.input-field { width: 100%; padding: 12px 16px; border: 1px solid var(--border); border-radius: 12px; font-size: 14px; font-family: 'Inter', sans-serif; outline: none; transition: border-color 0.2s; }
.input-field:focus { border-color: var(--primary); }
.btn { padding: 12px 24px; border: none; border-radius: 12px; font-size: 14px; font-weight: 600; font-family: 'Inter', sans-serif; cursor: pointer; transition: all 0.2s; }
.btn-primary { background: var(--primary); color: white; }
.btn-primary:hover { background: var(--primary-light); transform: translateY(-1px); }
.tabs { display: flex; gap: 4px; background: var(--bg); padding: 4px; border-radius: 12px; margin-bottom: 20px; }
.tab { flex: 1; padding: 10px; text-align: center; border-radius: 10px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; color: var(--text-light); }
.tab.active { background: var(--card); color: var(--text); box-shadow: var(--shadow); }
@media print { body { background: white; } .card { box-shadow: none; break-inside: avoid; } }
@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } .container { padding: 16px; } }
</style>
</head>

CHAQUE PRODUIT DOIT :
- Utiliser ce système de design comme BASE mais adapter les couleurs au thème (fitness=vert/énergie, budget=bleu/confiance, cuisine=orange/chaleur, mariage=rose/élégance, etc.)
- Avoir au minimum 300 lignes de HTML
- Contenir au moins 6 sections avec du VRAI contenu utile (pas de placeholders)
- Inclure de l'interactivité JavaScript : checkboxes qui sauvegardent en localStorage, barres de progression automatiques, calculs dynamiques, onglets fonctionnels
- Avoir des animations CSS douces (transitions, hover effects)
- Être visuellement DIFFÉRENT des autres produits de la même génération (couleurs différentes, layout différent, type d'interactivité différent)

TYPES DE PRODUITS ET CONTENU ATTENDU :

TRACKER/PLANNER : Cards avec checkboxes par catégorie, barre de progression globale, stats en haut (% complété, jours restants), section notes éditable, onglets par période (semaine/mois), sauvegarde localStorage

WORKBOOK/GUIDE : Sections numérotées avec contenu éducatif réel, exercices interactifs avec champs de saisie, quiz avec auto-correction, barre de progression par chapitre, design livre/magazine

DASHBOARD/TRACKER CHIFFRÉ : Champs de saisie numériques, calculs automatiques (totaux, moyennes, %), graphiques CSS (barres horizontales colorées), comparaisons objectif vs réel, tableau récapitulatif stylisé

TEMPLATE IMPRIMABLE : Design soigné orienté impression, @media print optimisé, sections clairement délimitées, espaces pour écrire, design épuré mais élégant

IMPORTANT : Chaque produit d'une génération doit être un TYPE DIFFÉRENT. Si la niche est "budget", génère par exemple : 1) un dashboard de suivi des dépenses avec calculs, 2) un planner budgétaire mensuel avec objectifs, 3) un workbook d'éducation financière avec exercices. PAS 3 variations du même tracker.

Réponds UNIQUEMENT avec le code HTML complet, sans markdown, sans backticks, sans explication. Juste le HTML de <!DOCTYPE html> à </html>.`;

// ─── Appel Anthropic ──────────────────────────────────────────────────────────
async function callAnthropic(system, userMsg, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  return response.json();
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, type, priceRange, tone, outputLang } = req.body || {};

  // Quota check uniquement sur les démarrages de génération (pas sur les appels HTML individuels)
  if (type === 'metadata_only' || type === 'all' || !type) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    const quota = await checkServerQuota(token);
    if (!quota.ok) return res.status(429).json({ error: { message: quota.message } });
  }

  let systemPrompt, userPrompt, maxTokens;

  // ── Appel 1 : Métadonnées uniquement (noms, descriptions, tags, prix) ────────
  if (type === 'metadata_only') {
    systemPrompt = SYSTEM_META;
    const lang = outputLang === 'fr' ? 'Contenu en français uniquement'
      : outputLang === 'en' ? 'Contenu en anglais uniquement'
      : 'Contenu bilingue français + anglais';
    const price = priceRange === 'economique' ? 'Fourchette cible : 5-10€'
      : priceRange === 'premium' ? 'Fourchette cible : 20-35€'
      : 'Fourchette cible : 10-20€';
    const toneStr = tone === 'decontracte' ? 'Ton décontracté et accessible'
      : tone === 'luxe' ? 'Ton luxe et haut de gamme'
      : 'Ton professionnel et moderne';
    userPrompt = `Génère les métadonnées pour 3 produits digitaux HTML pour la niche "${prompt}".
${price} | ${toneStr} | ${lang}
IMPÉRATIF : Les 3 produits doivent être de TYPES RADICALEMENT DIFFÉRENTS (TRACKER, WORKBOOK, DASHBOARD ou TEMPLATE — un de chaque catégorie, jamais deux fois le même).`;
    maxTokens = 2000;

  // ── Appel 2/3/4 : HTML complet pour UN produit ───────────────────────────────
  } else if (type === 'product_html') {
    systemPrompt = SYSTEM_HTML;
    userPrompt = prompt; // Prompt complet construit côté frontend
    maxTokens = 8000;

  // ── Legacy : tout en un seul appel (fallback) ─────────────────────────────────
  } else {
    systemPrompt = SYSTEM_HTML;
    const lang = outputLang === 'fr' ? 'Contenu principal en français'
      : outputLang === 'en' ? 'Contenu principal en anglais'
      : 'Contenu bilingue français + anglais';
    const price = priceRange === 'economique' ? 'Fourchette de prix cible : 5-10€'
      : priceRange === 'premium' ? 'Fourchette de prix cible : 20-35€'
      : 'Fourchette de prix cible : 10-20€';
    const toneStr = tone === 'decontracte' ? 'Ton décontracté et accessible'
      : tone === 'luxe' ? 'Ton luxe et haut de gamme'
      : 'Ton professionnel et moderne';
    userPrompt = `Génère 3 produits digitaux HTML premium pour la niche "${prompt}".
${price} | ${toneStr} | ${lang}
Les 3 produits doivent être RADICALEMENT différents (types différents).
Réponds en JSON : {"boutique":"...","products":[{"type":"...","nameFr":"...","nameEn":"...","descFr":"...","descEn":"...","tags":[],"tagsEn":[],"price":"","color":"","emoji":"","features":[],"html":"CODE HTML (apostrophes pour attributs)"},...]}`;
    maxTokens = 16000;
  }

  try {
    const data = await callAnthropic(systemPrompt, userPrompt, maxTokens);
    return res.status(200).json(data);
  } catch (err) {
    console.error('[generate] Error:', err);
    return res.status(500).json({ error: { message: err.message } });
  }
}
