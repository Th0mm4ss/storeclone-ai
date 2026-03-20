// Node.js runtime — requis pour le SDK Stripe officiel
import Stripe from 'stripe';

const SUPABASE_URL = 'https://hbaaqukxtoqxaxcbqmkj.supabase.co';

const VALID_PRICES = [
  'price_1TCpL1FYDfyCcjvz2Wbc8ph7', // Pro — 19€/mois
  'price_1TCpL2FYDfyCcjvzL7AZoZl1', // Business — 49€/mois
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ── 1. Token Authorization ─────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    console.error('[Checkout] Authorization header manquant ou malformé');
    return res.status(401).json({ error: 'Token manquant — veuillez vous reconnecter' });
  }
  const token = authHeader.slice(7).trim();

  // ── 2. Validation du token avec Supabase SERVICE_ROLE_KEY ─────────────────
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('[Checkout] SUPABASE_SERVICE_ROLE_KEY non configurée');
    return res.status(500).json({ error: 'Configuration serveur incomplète' });
  }

  let authUser;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey,
      },
    });
    if (!userRes.ok) {
      const body = await userRes.text();
      console.error('[Checkout] Supabase auth/v1/user →', userRes.status, body);
      return res.status(401).json({ error: 'Session expirée — veuillez vous reconnecter' });
    }
    authUser = await userRes.json();
  } catch (err) {
    console.error('[Checkout] Fetch Supabase auth threw:', err.message);
    return res.status(500).json({ error: 'Erreur de validation du token' });
  }

  console.log('[Checkout] Auth OK —', authUser.email);

  // ── 3. Lire et nettoyer le priceId ────────────────────────────────────────
  const rawPriceId = req.body?.priceId;
  const priceId = String(rawPriceId ?? '').trim().replace(/['"]/g, '');

  console.log('[Checkout] priceId brut:', JSON.stringify(rawPriceId), '→ nettoyé:', priceId);

  if (!priceId || !VALID_PRICES.includes(priceId)) {
    console.error('[Checkout] priceId invalide:', priceId);
    return res.status(400).json({ error: 'Plan inconnu' });
  }

  // ── 4. Initialiser le SDK Stripe ──────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('[Checkout] STRIPE_SECRET_KEY non configurée');
    return res.status(500).json({ error: 'Configuration Stripe manquante' });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });
  const appUrl = (process.env.APP_URL || 'https://storeclone-ai.vercel.app').replace(/\/$/, '');

  // ── 5. Récupérer ou créer le customer Stripe ──────────────────────────────
  let customerId;
  try {
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}&select=stripe_customer_id`,
      { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
    );
    const subs = await subRes.json();
    customerId = subs?.[0]?.stripe_customer_id || null;
    console.log('[Checkout] customerId existant:', customerId || 'aucun');
  } catch (err) {
    console.warn('[Checkout] Lecture subscription échouée:', err.message);
  }

  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: authUser.email,
        metadata: { supabase_user_id: authUser.id },
      });
      customerId = customer.id;
      console.log('[Checkout] Customer Stripe créé:', customerId);

      // Sauvegarder dans Supabase (best-effort)
      fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ stripe_customer_id: customerId }),
      }).catch(e => console.warn('[Checkout] Sauvegarde customer_id échouée:', e.message));
    } catch (err) {
      console.error('[Checkout] Création customer Stripe échouée:', err.message);
      return res.status(500).json({ error: 'Impossible de créer le profil de paiement' });
    }
  }

  // ── 6. Créer la session Stripe Checkout avec le SDK officiel ──────────────
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app.html?payment=success`,
      cancel_url:  `${appUrl}/app.html?payment=cancelled`,
      metadata: { supabase_user_id: authUser.id },
      subscription_data: { metadata: { supabase_user_id: authUser.id } },
    });

    console.log('[Checkout] Session créée:', session.id, '— url:', session.url);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Checkout] stripe.checkout.sessions.create threw:', err.message);
    return res.status(500).json({ error: 'Erreur Stripe : ' + err.message });
  }
}
