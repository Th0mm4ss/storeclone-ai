// Node.js serverless runtime (supports longer execution for large AI responses)
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_DESIGN = `Tu es un designer produit expert spécialisé dans la création de produits digitaux premium vendus sur Etsy, Shopify et Gumroad. Tu crées des fichiers HTML interactifs d'une qualité exceptionnelle qui justifient un prix de 10-25€.

RÈGLES DE DESIGN ABSOLUES pour chaque fichier HTML :

1. DESIGN VISUEL PREMIUM :
- Utilise une palette de couleurs cohérente et moderne (pas de couleurs criardes)
- Typographie soignée : Google Fonts (Inter pour le texte, Playfair Display ou DM Serif Display pour les titres)
- Espacement généreux (padding, margin, line-height)
- Coins arrondis (border-radius: 12-16px)
- Ombres douces (box-shadow subtils)
- Dégradés légers et élégants
- Bordures fines et discrètes
- Le fichier doit ressembler à une app Notion/Canva, PAS à un document Word

2. INTERACTIVITÉ OBLIGATOIRE (JavaScript intégré) :
- Cases à cocher qui se sauvegardent (localStorage)
- Barres de progression qui se mettent à jour automatiquement
- Champs de saisie éditables par l'utilisateur
- Sections repliables/dépliables
- Onglets si le contenu est long
- Compteurs automatiques (ex: total des dépenses, jours restants)
- Animations douces au survol et au clic (transitions CSS)

3. STRUCTURE ET CONTENU :
- Header avec titre du produit + icône/emoji pertinent + date du jour auto
- Au moins 5-8 sections de contenu substantiel
- Chaque section doit avoir un vrai contenu utile (pas du lorem ipsum, pas de placeholders)
- Tableaux stylisés avec alternance de couleurs de lignes
- Listes avec des icônes personnalisées (pas de puces classiques)
- Footer avec crédits et espace pour notes personnelles

4. RESPONSIVE ET IMPRIMABLE :
- @media print { } pour une impression propre
- Le design doit fonctionner sur mobile et desktop
- @media (max-width: 768px) { } pour adapter le layout

5. AUTONOMIE TOTALE :
- Tout le CSS doit être inline dans une balise <style>
- Tout le JS doit être dans une balise <script>
- Aucune dépendance externe sauf Google Fonts
- Le fichier doit fonctionner en ouvrant simplement le .html dans un navigateur

TYPES DE PRODUITS PAR NICHE (adapte le type au contexte) :
- Budget/Finance : Tracker de dépenses interactif avec catégories, graphiques CSS, calculs automatiques, objectifs d'épargne avec progression
- Fitness : Programme d'entraînement avec jours cochables, timer intégré, suivi de séries/reps, graphique de progression
- Productivité : Planner hebdomadaire/mensuel avec drag-and-drop simplifié, priorités colorées, section objectifs avec progression
- Cuisine : Livre de recettes interactif avec ingrédients ajustables par portions, timer de cuisson, checklist des ingrédients
- Mariage : Planning complet avec timeline, budget tracker, checklist des tâches avec deadlines, liste d'invités
- Voyage : Itinéraire interactif avec jours, budget par jour, checklist de valise, notes par destination
- Bien-être : Journal de gratitude/humeur avec calendrier, suivi d'habitudes, section méditation avec timer
- Éducation : Fiches de révision interactives, quiz auto-correctif, planning de révision avec Pomodoro timer

QUALITÉ DU CODE :
- HTML5 sémantique
- CSS moderne (flexbox, grid, custom properties)
- JavaScript vanilla propre (addEventListener, pas de onclick inline sauf exceptions simples)
- Commentaires dans le code pour que l'acheteur puisse personnaliser`;

const SYSTEM_META = `Tu es un expert en e-commerce, SEO et copywriting pour les marketplaces (Etsy, Shopify, Gumroad). Tu génères des fiches produits digitaux qui se vendent.

Règles :
- Chaque titre doit être unique, accrocheur et contenir des mots-clés SEO pertinents
- Les descriptions doivent être persuasives, orientées bénéfices (pas features), et faire 80-100 mots
- Génère exactement 13 tags par produit, du plus spécifique au plus général
- Les prix doivent être réalistes pour le marché des produits digitaux
- Chaque produit doit être véritablement différent des autres (pas juste des variations du même concept)
- Les noms de produits doivent donner envie d'acheter immédiatement

Réponds UNIQUEMENT en JSON valide sans markdown ni backticks.`;

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, type, priceRange, tone, outputLang } = req.body || {};

  let systemPrompt, userPrompt, maxTokens;

  if (type === 'product_html') {
    // Legacy: individual HTML product generation
    systemPrompt = SYSTEM_DESIGN;
    userPrompt = prompt;
    maxTokens = 8000;

  } else if (type === 'metadata') {
    // Legacy: metadata only
    systemPrompt = SYSTEM_META;
    userPrompt = prompt;
    if (priceRange || tone || outputLang) {
      const extras = [];
      if (priceRange) extras.push(`Fourchette de prix: ${priceRange}`);
      if (tone) extras.push(`Ton: ${tone}`);
      if (outputLang && outputLang !== 'both') extras.push(`Langue: ${outputLang === 'fr' ? 'français uniquement' : 'anglais uniquement'}`);
      if (extras.length) userPrompt += '\n\nContraintes:\n' + extras.join('\n');
    }
    maxTokens = 2000;

  } else {
    // NEW default: full generation — metadata + complete HTML in one JSON response
    systemPrompt = SYSTEM_DESIGN;

    const langLine = outputLang === 'fr' ? 'Contenu principal en français'
      : outputLang === 'en' ? 'Contenu principal en anglais'
      : 'Contenu bilingue français + anglais';

    const priceLine = priceRange === 'economique' ? 'Fourchette de prix cible : 5-10€'
      : priceRange === 'premium' ? 'Fourchette de prix cible : 20-35€'
      : 'Fourchette de prix cible : 10-20€';

    const toneLine = tone === 'decontracte' ? 'Ton décontracté et accessible'
      : tone === 'luxe' ? 'Ton luxe et haut de gamme'
      : 'Ton professionnel et moderne';

    userPrompt = `Génère 3 produits digitaux HTML premium pour la niche "${prompt}".

${priceLine}
${toneLine}
${langLine}

CONTRAINTE ABSOLUE POUR LE JSON :
- Dans les valeurs "html", utilise UNIQUEMENT des apostrophes (') pour les attributs HTML, jamais de guillemets doubles
- Les retours à la ligne dans les valeurs string JSON doivent être écrits \\n
- Le JSON doit être strictement valide et parseable par JSON.parse()

Les 3 produits doivent être RADICALEMENT différents les uns des autres.
Chaque fichier HTML doit faire au minimum 200 lignes, avec un vrai contenu utile et des interactions complètes.

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks) :
{"boutique":"Nom de marque accrocheur","products":[{"type":"Type de produit","nameFr":"Nom FR premium","nameEn":"English name","descFr":"Description FR 80-100 mots orientée bénéfices","descEn":"English description 80-100 words","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13"],"tagsEn":["tag1","tag2","tag3","tag4","tag5"],"price":"XX.XX","color":"#hexcolor","emoji":"emoji","features":["feature1","feature2","feature3","feature4"],"html":"CODE HTML COMPLET ICI (apostrophes pour attributs, \\n pour retours ligne)"},{"type":"...","nameFr":"...","nameEn":"...","descFr":"...","descEn":"...","tags":[],"tagsEn":[],"price":"","color":"","emoji":"","features":[],"html":"CODE HTML COMPLET"},{"type":"...","nameFr":"...","nameEn":"...","descFr":"...","descEn":"...","tags":[],"tagsEn":[],"price":"","color":"","emoji":"","features":[],"html":"CODE HTML COMPLET"}]}`;

    maxTokens = 16000;
  }

  try {
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
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('[generate] Error:', err);
    return res.status(500).json({ error: { message: err.message } });
  }
}
