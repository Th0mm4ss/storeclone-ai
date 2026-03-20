export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://hbaaqukxtoqxaxcbqmkj.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  // ── 1. Token dans le header Authorization ────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    console.error('[Checkout] Authorization header manquant ou malformé');
    return json({ error: 'Token manquant — veuillez vous reconnecter' }, 401);
  }
  const token = authHeader.slice(7);

  // ── 2. Validation via SERVICE_ROLE_KEY (pas l'anon key) ──────────────────
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('[Checkout] SUPABASE_SERVICE_ROLE_KEY non configurée');
    return json({ error: 'Configuration serveur incomplète' }, 500);
  }

  let authUser;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey,   // ← service_role, pas anon_key
      },
    });
    if (!userRes.ok) {
      const body = await userRes.text();
      console.error('[Checkout] Supabase auth/v1/user →', userRes.status, body);
      return json({ error: 'Session expirée — veuillez vous reconnecter' }, 401);
    }
    authUser = await userRes.json();
  } catch (err) {
    console.error('[Checkout] Fetch /auth/v1/user threw:', err.message);
    return json({ error: 'Erreur de validation du token' }, 500);
  }

  console.log('[Checkout] Auth OK —', authUser.email);

  // ── 3. Lire et valider le priceId ────────────────────────────────────────
  let priceId;
  try {
    const body = await req.json();
    priceId = body.priceId;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const VALID_PRICES = [
    'price_1TCpL1FYDfyCcjvz2Wbc8ph7', // Pro — 19€/mois
    'price_1TCpL2FYDfyCcjvzL7AZoZl1', // Business — 49€/mois
  ];
  if (!priceId || !VALID_PRICES.includes(priceId)) {
    console.error('[Checkout] priceId invalide:', priceId);
    return json({ error: 'Plan inconnu' }, 400);
  }

  // ── 4. Env vars Stripe ───────────────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('[Checkout] STRIPE_SECRET_KEY non configurée');
    return json({ error: 'Configuration Stripe manquante' }, 500);
  }
  const appUrl = (process.env.APP_URL || 'https://storeclone-ai.vercel.app').replace(/\/$/, '');

  // ── 5. Récupérer ou créer le customer Stripe ─────────────────────────────
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
      const custRes = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: authUser.email,
          'metadata[supabase_user_id]': authUser.id,
        }),
      });
      const customer = await custRes.json();
      if (customer.error) throw new Error(customer.error.message);
      customerId = customer.id;
      console.log('[Checkout] Customer Stripe créé:', customerId);

      // Sauvegarder (best-effort — n'échoue pas si ça plante)
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
      return json({ error: 'Impossible de créer le profil de paiement' }, 500);
    }
  }

  // ── 6. Créer la session Stripe Checkout ──────────────────────────────────
  try {
    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: customerId,
        mode: 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: `${appUrl}/app.html?payment=success`,
        cancel_url:  `${appUrl}/app.html?payment=cancelled`,
        'metadata[supabase_user_id]': authUser.id,
        'subscription_data[metadata][supabase_user_id]': authUser.id,
      }),
    });
    const session = await sessionRes.json();
    if (session.error) {
      console.error('[Checkout] Stripe session error:', session.error);
      return json({ error: 'Erreur Stripe : ' + session.error.message }, 400);
    }
    console.log('[Checkout] Session créée:', session.id);
    return json({ url: session.url });
  } catch (err) {
    console.error('[Checkout] Stripe fetch threw:', err.message);
    return json({ error: 'Erreur lors de la création du paiement' }, 500);
  }
}
