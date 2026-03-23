import Stripe from 'stripe';

const SUPABASE_URL = 'https://hbaaqukxtoqxaxcbqmkj.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  // ── 1. Token Authorization ─────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const token = authHeader.slice(7).trim();

  // ── 2. Valider le token Supabase ───────────────────────────────────────────
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Configuration manquante' });

  let authUser;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
    });
    if (!r.ok) return res.status(401).json({ error: 'Session expirée' });
    authUser = await r.json();
  } catch (err) {
    return res.status(500).json({ error: 'Erreur auth: ' + err.message });
  }

  // ── 3. Récupérer le stripe_customer_id ────────────────────────────────────
  let customerId;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}&select=stripe_customer_id`,
      { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
    );
    const data = await r.json();
    customerId = data?.[0]?.stripe_customer_id;
  } catch (err) {
    return res.status(500).json({ error: 'Erreur Supabase: ' + err.message });
  }

  if (!customerId) {
    return res.status(400).json({ error: 'Aucun abonnement actif trouvé' });
  }

  // ── 4. Créer la session Customer Portal ───────────────────────────────────
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://storeclone-ai.com/app.html',
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Portal] Stripe error:', err.message);
    return res.status(500).json({ error: 'Erreur portail: ' + err.message });
  }
}
