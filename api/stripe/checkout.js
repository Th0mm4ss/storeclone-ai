export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://hbaaqukxtoqxaxcbqmkj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhiYWFxdWt4dG9xeGF4Y2JxbWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTUzMDAsImV4cCI6MjA4OTUzMTMwMH0.xGjjmNPzDcYMj-Y4FcOqArNXagxHdj1RXYAEA11LVhQ';

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
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Vérifier le JWT Supabase
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Non autorisé' }, 401);

  const token = authHeader.slice(7);
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) return json({ error: 'Token invalide' }, 401);
  const authUser = await userRes.json();

  const { priceId } = await req.json();
  if (!priceId) return json({ error: 'priceId manquant' }, 400);

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.APP_URL || 'https://storeclone-ai.vercel.app';

  // Récupérer le customer_id Stripe existant depuis Supabase
  const subRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}&select=stripe_customer_id`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
  );
  const subs = await subRes.json();
  let customerId = subs[0]?.stripe_customer_id;

  // Créer le customer Stripe si nécessaire
  if (!customerId) {
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
    customerId = customer.id;

    // Sauvegarder le customer_id dans Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ stripe_customer_id: customerId }),
    });
  }

  // Créer la session Stripe Checkout
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
      success_url: `${appUrl}/app.html?checkout=success`,
      cancel_url: `${appUrl}/app.html?checkout=cancelled`,
      // Stocker l'user_id Supabase dans les métadonnées de la session ET de la subscription
      'metadata[supabase_user_id]': authUser.id,
      'subscription_data[metadata][supabase_user_id]': authUser.id,
    }),
  });

  const session = await sessionRes.json();
  if (session.error) return json({ error: session.error.message }, 400);

  return json({ url: session.url });
}
