// Node.js serverless runtime (supports longer execution)
export const maxDuration = 60;

// ─── Rate limiting (in-memory, resets per cold start) ─────────────────────────
const rateLimitMap = new Map(); // userId → { count, resetAt }
function checkRateLimit(userId) {
  if (!userId) return true; // no userId = pass through
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

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
- 13 tags FR par produit, du plus spécifique au plus général, optimisés Etsy
- 13 tags EN par produit (tagsEn) : différents des tags FR, couvrant synonymes et recherches connexes, optimisés pour Etsy international
- Prix réalistes pour produits digitaux (5€-35€)
- color : couleur HEX principale adaptée à la niche, différente pour chaque produit — ce sera la couleur CSS --primary du fichier HTML généré

Réponds UNIQUEMENT en JSON valide sans markdown ni backticks :
{"boutique":"Nom de marque accrocheur","products":[{"name":"Nom FR premium","nameEn":"English name","type":"TRACKER|WORKBOOK|DASHBOARD|TEMPLATE","description":"Description FR 80-100 mots orientée bénéfices","descriptionEn":"English description 80-100 words","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13"],"tagsEn":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13"],"price":"14.99","color":"#hexcolor","emoji":"emoji","features":["feature1","feature2","feature3","feature4"]},{"name":"...","nameEn":"...","type":"...","description":"...","descriptionEn":"...","tags":[],"tagsEn":[],"price":"","color":"","emoji":"","features":[]},{"name":"...","nameEn":"...","type":"...","description":"...","descriptionEn":"...","tags":[],"tagsEn":[],"price":"","color":"","emoji":"","features":[]}]}`;

// ─── System prompt — HTML (v3 — design diversifié, zéro watermark) ────────────
const SYSTEM_HTML = `Tu es un designer produit UI/UX de classe mondiale. Tu crées des fichiers HTML autonomes qui ressemblent à des applications web professionnelles haut de gamme, PAS à des documents.

RÈGLES ABSOLUES — si tu ne respectes pas ces règles, le produit est invendable :

1. MINIMUM 400 LIGNES DE CODE — Un fichier plus court est bâclé. Chaque section doit avoir du VRAI contenu.

2. PALETTE DE COULEURS SELON LA NICHE — obligatoire, pas de palette générique :
- fitness / sport / musculation → fond #0F0F0F, accent #E94560, texte blanc sur dark
- yoga / méditation / bien-être → fond #F0EDE8, accent #7B6F5E, tons naturels chauds
- budget / finance / argent / comptabilité → fond #0A1628, accent #3B82F6, tons bleu nuit professionnel
- mariage / couple / amour → fond #FDF6F0, accent #C4837A, tons rose poudré champagne
- cuisine / nutrition / recettes / repas → fond #FFFBF0, accent #E07B39, tons chauds orangés
- bébé / parentalité / grossesse / enfants → fond #F0F7FF, accent #60A5FA, tons pastel doux
- productivité / organisation / travail → fond #F8F8F8, accent #111111, tons neutres épurés
- voyage / aventure / découverte → fond #0C1F3F, accent #38BDF8, tons bleu océan
- art / créativité / design → fond #1A1A2E, accent #E94560, tons sombres créatifs
- Par défaut si niche inconnue → choisir UNE palette cohérente avec le thème, jamais #F5F5F7 générique
RÈGLE ABSOLUE : NE JAMAIS utiliser la palette violet/indigo par défaut.

3. TYPOGRAPHIE — 2 polices Google Fonts OBLIGATOIRES, chargées dans le <head> :
- 1 police display pour les titres H1/H2 : choisir parmi Playfair Display, Fraunces, Bebas Neue, Outfit, DM Serif Display, Cormorant Garamond — selon la niche
- 1 police lisible pour le corps : choisir parmi DM Sans, Plus Jakarta Sans, Nunito, Lato, Work Sans
- JAMAIS Inter seul. Les deux polices doivent être déclarées dans :root.

4. STRUCTURE / LAYOUT — choisir UN layout parmi les 4 selon le type de produit :
- Layout A (DASHBOARD) : sidebar fixe à gauche 240px + zone principale à droite, navigation par sections
- Layout B (TRACKER) : header pleine largeur + grille de cards en dessous, vue d'ensemble
- Layout C (WORKBOOK) : navigation par onglets en haut + contenu unique par onglet
- Layout D (TEMPLATE) : page scroll linéaire avec sections séparées par des dividers élégants
Ne jamais utiliser le même layout pour les 3 produits d'une même génération.

4bis. VARIATION DE COULEUR ACCENT ENTRE LES 3 PRODUITS :
Les 3 produits d'une même collection partagent la même palette de base (fond + couleur principale) mais ont chacun une couleur d'ACCENT secondaire différente selon leur position :
- Produit 1 (accent A) : couleur accent principale de la niche
- Produit 2 (accent B) : variante complémentaire (ex: si accent A = rouge → accent B = vert complémentaire)
- Produit 3 (accent C) : variante triadique (ex: si accent A = rouge → accent C = jaune/orangé)
Exemple fitness dark : accent A = #E94560 (rouge), accent B = #00D4AA (teal), accent C = #FFB347 (orange)
Exemple yoga naturel : accent A = #7B6F5E (brun), accent B = #6B9E7A (vert sauge), accent C = #C9A86C (doré)
Cela rend chaque produit reconnaissable tout en maintenant la cohérence de la collection.

5. FONCTIONNALITÉS OBLIGATOIRES :
- Champ de personnalisation en haut : permettre à l'utilisateur de saisir son prénom ou son objectif principal
  (ex: "Mon prénom", "Mon objectif", "Mon budget mensuel" selon la niche)
- localStorage pour persister TOUTES les données (clé : 'sc_' + slug du produit)
- Au chargement : restaurer toutes les données sauvegardées
- Au moins 1 graphique SVG ou canvas : barres de progression SVG, camembert canvas, ou histogramme animé
- Bouton "Réinitialiser" bien visible
- Bouton "🖨️ Imprimer" qui appelle window.print()
- Les checkboxes : toggle classe 'done' + save() + updateProgress()
- Les inputs/textareas : save() au blur
- Fonction updateProgress() : calcule % et met à jour barres + compteurs

6. CONTENU RÉEL — JAMAIS de placeholders :
- JAMAIS "Tâche 1", "Item A", "Catégorie X", "Lorem ipsum"
- Au moins 15-20 items de contenu réel et pertinent pour la niche
- budget → "Loyer", "Courses", "Transport", "Électricité", "Internet", "Assurance", "Épargne", "Loisirs"
- fitness → "Squats 3×12", "Pompes 3×15", "Planche 60s", "Fentes 3×10", "Burpees 3×8"
- mariage → traiteur, photographe, DJ, fleuriste, invitations, robe, alliances, lieu...
- cuisine → vraies recettes avec ingrédients et temps de cuisson

7. ANIMATIONS ET MICRO-INTERACTIONS :
- @keyframes fadeIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
- animation: fadeIn 0.4s ease staggered sur les sections au chargement
- transition: all 0.2s ease sur TOUS les éléments interactifs
- Hover sur cards : transform: translateY(-2px) + box-shadow augmentée
- Barres de progression : transition: width 0.5s ease
- Compteurs animés au chargement (count up de 0 vers la valeur)

8. RESPONSIVE + PRINT :
- @media (max-width: 768px) : layout en 1 colonne, padding 16px, font-size ajusté, sidebar cachée
- @media print : masquer boutons, pas de backgrounds colorés, break-inside:avoid sur les cards

9. STRUCTURE OBLIGATOIRE :
- <head> : charset, viewport, title, Google Fonts (2 polices), <style> complet
- Champ de personnalisation tout en haut (nom utilisateur / objectif)
- Header : emoji 48px + H1 (police display) + sous-titre + date auto
- Section stats : 3-4 .stat-card avec compteurs dynamiques
- 4-6 sections de contenu principal avec vrai contenu
- Graphique SVG ou canvas intégré
- Section notes avec textarea sauvegardé
- Footer : boutons Réinitialiser + Imprimer — NE PAS mentionner "StoreClone AI" ni aucun outil tiers. Footer = "© 2026 — [Nom du produit]" uniquement.
- <script> : DOMContentLoaded, save(), load(), updateProgress(), handlers complets

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

  const { prompt, type, priceRange, tone, outputLang, style, layout, complexity, audience } = req.body || {};

  // Input validation
  if (prompt && typeof prompt === 'string' && prompt.replace(/<[^>]*>/g, '').length > 100 && type !== 'product_html' && type !== 'edit_html') {
    return res.status(400).json({ error: { message: 'La niche ne peut pas dépasser 100 caractères.' } });
  }

  // Quota check uniquement sur les démarrages de génération (pas sur les appels HTML individuels)
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (type === 'metadata_only' || type === 'all' || !type) {
    const quota = await checkServerQuota(token);
    if (!quota.ok) return res.status(429).json({ error: { message: quota.message } });
  }

  // Rate limit (extract userId from token)
  try {
    if (token) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const userId = payload?.sub;
      if (userId && !checkRateLimit(userId)) {
        return res.status(429).json({ error: { message: 'Trop de requêtes. Attendez une minute avant de réessayer.' } });
      }
    }
  } catch (_) { /* invalid token format — ignore */ }

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

  // ── Appel éditeur IA : modification d'un fichier HTML existant ───────────────
  } else if (type === 'edit_html') {
    systemPrompt = `Tu es un expert en modification de fichiers HTML. Tu reçois un fichier HTML existant et des instructions de modification. Tu dois retourner le fichier HTML modifié en conservant le design existant et en appliquant exactement les changements demandés. Réponds UNIQUEMENT avec le code HTML complet modifié, sans markdown, sans backticks, sans explication avant ou après.`;
    userPrompt = prompt; // Contains current HTML + user instructions
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
