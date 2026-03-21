import crypto from 'crypto';

// Désactiver le bodyParser pour lire le raw body (requis par Stripe)
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = 'https://hbaaqukxtoqxaxcbqmkj.supabase.co';

// Correspondance price_id → plan (6 prix : Pro/Business × mensuel/trimestriel/annuel)
const PRICE_TO_PLAN = {
  'price_1TDCSQFYDfyCcjvzGJVEYOQB': 'pro',      // Pro mensuel
  'price_1TDMCJFYDfyCcjvzmDgpL57l': 'pro',      // Pro trimestriel
  'price_1TDMCRFYDfyCcjvzbeO7wEDQ': 'pro',      // Pro annuel
  'price_1TDCSaFYDfyCcjvz4u27klDM': 'business', // Business mensuel
  'price_1TDMCaFYDfyCcjvzfZkECTOE': 'business', // Business trimestriel
  'price_1TDMCiFYDfyCcjvzd792JSYe': 'business', // Business annuel
};

// ─── Supabase helpers ──────────────────────────────────────────────────────────

function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
}

// Upsert (insert or update) de la subscription via user_id
async function upsertSubscription(userId, data) {
  const body = JSON.stringify({ user_id: userId, ...data, updated_at: new Date().toISOString() });
  console.log('[Webhook] upsertSubscription → userId:', userId, '| data:', JSON.stringify(data));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: supaHeaders(),
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[Webhook] upsertSubscription FAILED — status:', res.status, '| body:', text);
  } else {
    console.log('[Webhook] upsertSubscription OK');
  }
}

// Chercher le user_id Supabase depuis un stripe_customer_id (pour les events subscription.*)
async function getUserIdByCustomer(stripeCustomerId) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?stripe_customer_id=eq.${stripeCustomerId}&select=user_id`,
    { headers: { Authorization: `Bearer ${key}`, apikey: key } }
  );
  const rows = await res.json();
  const userId = rows?.[0]?.user_id || null;
  console.log('[Webhook] getUserIdByCustomer:', stripeCustomerId, '→', userId);
  return userId;
}

// ─── Stripe helpers ────────────────────────────────────────────────────────────

function verifyStripeSignature(rawBody, sigHeader, secret) {
  const timestamp = sigHeader.match(/t=(\d+)/)?.[1];
  if (!timestamp) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;
  const signatures = [...sigHeader.matchAll(/v1=([a-f0-9]+)/g)].map((m) => m[1]);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return signatures.includes(expected);
}

async function fetchStripeSubscription(subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  console.log('[Webhook] ▶ incoming request — method:', req.method);

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Lire le raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // Vérifier la signature Stripe
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  console.log('[Webhook] stripe-signature present:', !!sig, '| webhookSecret present:', !!webhookSecret);

  if (!sig || !webhookSecret || !verifyStripeSignature(rawBody, sig, webhookSecret)) {
    console.error('[Webhook] ❌ Signature verification FAILED');
    return res.status(400).json({ error: 'Signature invalide' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error('[Webhook] ❌ JSON parse error:', err.message);
    return res.status(400).json({ error: 'JSON invalide' });
  }

  console.log('[Webhook] ✅ event type:', event.type, '| id:', event.id);

  try {
    switch (event.type) {

      // ── Paiement confirmé (checkout via Payment Link) ────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('[Webhook] checkout.session.completed — session.id:', session.id);
        console.log('[Webhook]   client_reference_id:', session.client_reference_id);
        console.log('[Webhook]   metadata:', JSON.stringify(session.metadata));
        console.log('[Webhook]   customer:', session.customer);
        console.log('[Webhook]   subscription:', session.subscription);

        // client_reference_id = authUser.id passé dans l'URL du Payment Link
        // fallback sur metadata.supabase_user_id pour la compatibilité
        const userId = session.client_reference_id || session.metadata?.supabase_user_id;

        if (!userId) {
          console.error('[Webhook] ❌ Aucun user_id trouvable — client_reference_id et metadata vides');
          break;
        }
        console.log('[Webhook] ✅ userId résolu:', userId);

        // Récupérer la subscription Stripe pour le price_id et current_period_end
        let plan = 'pro'; // Fallback sécurisé
        let currentPeriodEnd = null;

        if (session.subscription) {
          const stripeSub = await fetchStripeSubscription(session.subscription);
          console.log('[Webhook]   stripeSub.status:', stripeSub.status);
          const priceId = stripeSub.items?.data[0]?.price?.id;
          console.log('[Webhook]   priceId:', priceId, '→ plan:', PRICE_TO_PLAN[priceId] || '(inconnu, fallback pro)');
          plan = PRICE_TO_PLAN[priceId] || 'pro';
          currentPeriodEnd = stripeSub.current_period_end
            ? new Date(stripeSub.current_period_end * 1000).toISOString()
            : null;

          // Annuler l'ancien abonnement si différent (1 sub actif max par user)
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
          try {
            const existingRes = await fetch(
              `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=stripe_subscription_id`,
              { headers: { Authorization: `Bearer ${key}`, apikey: key } }
            );
            const existing = await existingRes.json();
            const oldSubId = existing?.[0]?.stripe_subscription_id;
            if (oldSubId && oldSubId !== session.subscription) {
              console.log('[Webhook] Annulation ancien abonnement Stripe:', oldSubId);
              await fetch(`https://api.stripe.com/v1/subscriptions/${oldSubId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
              });
            }
          } catch (err) {
            console.warn('[Webhook] Échec annulation ancien abonnement (non-bloquant):', err.message);
          }
        }

        await upsertSubscription(userId, {
          plan,
          status: 'active',
          stripe_subscription_id: session.subscription || null,
          stripe_customer_id: session.customer || null,
          current_period_end: currentPeriodEnd,
        });
        console.log('[Webhook] ✅ checkout.session.completed — plan mis à jour:', plan, 'pour userId:', userId);
        break;
      }

      // ── Abonnement modifié (renouvellement, upgrade, downgrade) ─────────────
      case 'customer.subscription.updated': {
        const stripeSub = event.data.object;
        console.log('[Webhook] customer.subscription.updated — sub.id:', stripeSub.id, '| customer:', stripeSub.customer);

        // Essayer metadata d'abord, sinon lookup par stripe_customer_id
        let userId = stripeSub.metadata?.supabase_user_id;
        if (!userId) userId = await getUserIdByCustomer(stripeSub.customer);

        if (!userId) {
          console.error('[Webhook] ❌ Impossible de résoudre userId pour customer:', stripeSub.customer);
          break;
        }

        const priceId = stripeSub.items?.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'starter';
        const status =
          stripeSub.status === 'active' ? 'active'
          : stripeSub.status === 'past_due' ? 'past_due'
          : 'cancelled';
        const currentPeriodEnd = stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000).toISOString()
          : null;

        console.log('[Webhook]   priceId:', priceId, '→ plan:', plan, '| status:', status);
        await upsertSubscription(userId, { plan, status, current_period_end: currentPeriodEnd });
        console.log('[Webhook] ✅ subscription.updated OK');
        break;
      }

      // ── Abonnement résilié ───────────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        console.log('[Webhook] customer.subscription.deleted — sub.id:', stripeSub.id, '| customer:', stripeSub.customer);

        let userId = stripeSub.metadata?.supabase_user_id;
        if (!userId) userId = await getUserIdByCustomer(stripeSub.customer);

        if (!userId) {
          console.error('[Webhook] ❌ Impossible de résoudre userId pour customer:', stripeSub.customer);
          break;
        }

        await upsertSubscription(userId, {
          plan: 'starter',
          status: 'cancelled',
          stripe_subscription_id: null,
          current_period_end: null,
        });
        console.log('[Webhook] ✅ subscription.deleted — retour Starter pour userId:', userId);
        break;
      }

      default:
        console.log('[Webhook] Event ignoré:', event.type);
    }
  } catch (err) {
    console.error('[Webhook] ❌ Erreur lors du traitement:', err.message, err.stack);
    // On répond 200 quand même pour éviter les retries Stripe inutiles
  }

  return res.status(200).json({ received: true });
}
