import crypto from 'crypto';

// Désactiver le bodyParser de Next.js/Vercel pour lire le raw body (requis par Stripe)
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = 'https://hbaaqukxtoqxaxcbqmkj.supabase.co';

// Correspondance price_id → plan
const PRICE_TO_PLAN = {
  'price_1TCpL1FYDfyCcjvz2Wbc8ph7': 'pro',
  'price_1TCpL2FYDfyCcjvzL7AZoZl1': 'business',
};

async function updateSubscription(userId, data) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  });
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  const timestamp = sigHeader.match(/t=(\d+)/)?.[1];
  if (!timestamp) return false;
  // Rejeter les événements de plus de 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;
  const signatures = [...sigHeader.matchAll(/v1=([a-f0-9]+)/g)].map((m) => m[1]);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return signatures.includes(expected);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Lire le raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // Vérifier la signature Stripe
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !verifyStripeSignature(rawBody, sig, webhookSecret)) {
    return res.status(400).json({ error: 'Signature invalide' });
  }

  const event = JSON.parse(rawBody);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // L'user_id est dans les métadonnées de la session
      const userId = session.metadata?.supabase_user_id;
      if (!userId) break;

      // Récupérer la subscription Stripe pour connaître le price_id
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      });
      const stripeSub = await subRes.json();
      const priceId = stripeSub.items?.data[0]?.price?.id;
      const plan = PRICE_TO_PLAN[priceId] || 'starter';

      await updateSubscription(userId, {
        plan,
        status: 'active',
        stripe_subscription_id: session.subscription,
        stripe_customer_id: session.customer,
        current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
      });
      break;
    }

    case 'customer.subscription.updated': {
      const stripeSub = event.data.object;
      const userId = stripeSub.metadata?.supabase_user_id;
      if (!userId) break;

      const priceId = stripeSub.items?.data[0]?.price?.id;
      const plan = PRICE_TO_PLAN[priceId] || 'starter';
      const status =
        stripeSub.status === 'active' ? 'active'
        : stripeSub.status === 'past_due' ? 'past_due'
        : 'cancelled';

      await updateSubscription(userId, {
        plan,
        status,
        current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object;
      const userId = stripeSub.metadata?.supabase_user_id;
      if (!userId) break;

      await updateSubscription(userId, {
        plan: 'starter',
        status: 'cancelled',
        stripe_subscription_id: null,
        current_period_end: null,
      });
      break;
    }
  }

  res.status(200).json({ received: true });
}
