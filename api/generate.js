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

// ─── System prompt — HTML (v2 — exigences maximales) ─────────────────────────
const SYSTEM_HTML = `Tu es un designer produit UI/UX de classe mondiale. Tu crées des fichiers HTML autonomes qui ressemblent à des applications web professionnelles, PAS à des documents.

RÈGLES ABSOLUES — si tu ne respectes pas ces règles, le produit est invendable :

1. MINIMUM 350 LIGNES DE CODE — Un fichier plus court est un fichier bâclé. Chaque section doit avoir du VRAI contenu, pas du remplissage.

2. DESIGN SYSTEM OBLIGATOIRE :
- Définir des CSS custom properties dans :root (--primary, --primary-light, --primary-bg, --success, --bg, --card, --text, --text-light, --border, --radius, --shadow, --shadow-lg)
- Adapter TOUTES les couleurs à la niche :
  budget/finance → bleu foncé #1e40af + tons bleus
  fitness/sport → vert émeraude #059669 + tons verts
  cuisine/food → orange chaud #ea580c + tons orangés
  mariage/wedding → rose élégant #be185d + tons roses
  voyage/travel → bleu ciel #0284c7 + tons bleu clair
  bien-être/wellness → violet lavande #7c3aed + tons violets
  productivité → gris anthracite #374151 + tons neutres
  éducation → indigo #4338ca + tons indigo
- NE JAMAIS utiliser la palette violet/indigo par défaut pour toutes les niches
- Google Fonts : Inter pour le texte + une font d'accent selon le ton (Playfair Display pour luxe/élégance, Sora pour moderne/tech, DM Serif Display pour éditorial)

3. COMPOSANTS UI RICHES obligatoires (utiliser au moins 5 parmi) :
- Cards avec ombre et hover effect (transform: translateY(-2px) + shadow augmentée)
- Checkboxes stylisées qui se barrent quand cochées + sauvegarde localStorage
- Barres de progression animées (width transition 0.5s) calculées automatiquement
- Onglets (tabs) fonctionnels qui switchent le contenu sans recharger
- Champs de saisie stylisés (input, textarea) avec focus effect coloré
- Boutons avec hover/active states et transitions douces
- Badges colorés (statut, catégorie, priorité)
- Grille responsive (CSS Grid ou Flexbox) qui passe en 1 colonne sur mobile
- Compteurs automatiques (tâches complétées, totaux, moyennes)
- Accordéons (sections repliables au clic)

4. JAVASCRIPT INTERACTIF OBLIGATOIRE — CHAQUE ÉLÉMENT DOIT FONCTIONNER :
- TOUTES les données utilisateur se sauvegardent en localStorage
- Clé localStorage unique : 'storeclone_' + slug du nom produit (ex: 'storeclone_budget-mensuel')
- Au chargement (DOMContentLoaded), restaurer TOUTES les données sauvegardées
- Les checkboxes : addEventListener('change') → toggle classe 'done' sur le parent → save() → updateProgress()
- Les champs input/textarea : addEventListener('blur') → save()
- Les calculs : addEventListener('input') sur les champs numériques → recalculer en temps réel
- Les onglets : addEventListener('click') → toggle classe 'active' sur tab + show/hide sections
- Fonction updateProgress() qui calcule % = (cochés / total) * 100 et met à jour les barres et compteurs
- Bouton "Réinitialiser" : vide localStorage + reload()
- TESTER chaque interaction mentalement — pas de code mort, pas de function déclarée mais jamais appelée

5. CONTENU RÉEL ET UTILE — JAMAIS de placeholders :
- JAMAIS "Tâche 1", "Item A", "Catégorie X", "Lorem ipsum"
- Chaque item = vrai contenu pertinent pour la niche
  budget → "Loyer", "Courses alimentaires", "Transport", "Électricité", "Internet", "Assurance auto", "Épargne", "Loisirs", "Vêtements", "Santé/Pharma", "Abonnements", "Restaurant", "Sport", "Cadeau", "Imprévus"
  fitness → "Squats 3×12", "Pompes 3×15", "Planche 60s", "Fentes 3×10", "Burpees 3×8", "Tractions 3×6", "Crunches 3×20", "Mountain climbers 3×30s"
  cuisine → vraies recettes avec ingrédients réels et temps de cuisson
  mariage → vraies tâches (traiteur, photographe, DJ, fleuriste, invitations, robe, alliances...)
- Au moins 15-20 items de contenu réel par produit

6. ANIMATIONS ET MICRO-INTERACTIONS :
- @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
- animation: fadeIn 0.4s ease sur les sections au chargement
- transition: all 0.2s ease sur TOUS les éléments interactifs
- Hover sur cards : transform: translateY(-2px) + box-shadow augmentée
- Checkboxes : transition sur text-decoration et color
- Barres de progression : transition: width 0.5s ease
- Boutons actifs : transform: scale(0.98)

7. RESPONSIVE + PRINT :
- @media (max-width: 768px) : grille en 1 colonne, padding réduit (16px), font-size ajusté
- @media print : pas de shadows, pas de backgrounds colorés, break-inside: avoid sur les cards

8. STRUCTURE OBLIGATOIRE DU FICHIER :
- <head> : meta charset, viewport, title, Google Fonts link, <style> complet
- Header : emoji grand format (48px) + titre H1 + sous-titre + date auto (new Date().toLocaleDateString('fr-FR'))
- Section stats : 3-4 .stat-card avec compteurs dynamiques (tâches cochées, %, total)
- 4-6 sections de contenu principal avec vrai contenu
- Section notes/commentaires avec textarea sauvegardé
- Footer : bouton Réinitialiser + crédit discret
- <script> : DOMContentLoaded, save(), load(), updateProgress(), et handlers d'events

RAPPEL FINAL : Tu réponds UNIQUEMENT avec le code HTML complet, de <!DOCTYPE html> à </html>. Aucun markdown, aucun backtick, aucune explication avant ou après.`;

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
    maxTokens = 12000;

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
