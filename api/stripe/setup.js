// ENDPOINT TEMPORAIRE — supprimé après exécution
import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
  const redirectUrl = 'https://storeclone-ai.vercel.app/app.html?payment=success';

  // 1. Désactiver tous les anciens payment links
  const existing = await stripe.paymentLinks.list({ limit: 20 });
  for (const link of existing.data) {
    if (link.active) {
      await stripe.paymentLinks.update(link.id, { active: false });
      console.log('Désactivé:', link.id);
    }
  }

  // 2. Créer les 6 nouveaux avec redirection
  const PRICES = {
    pro_monthly:      'price_1TDCSQFYDfyCcjvzGJVEYOQB',
    pro_quarterly:    'price_1TDMCJFYDfyCcjvzmDgpL57l',
    pro_yearly:       'price_1TDMCRFYDfyCcjvzbeO7wEDQ',
    biz_monthly:      'price_1TDCSaFYDfyCcjvz4u27klDM',
    biz_quarterly:    'price_1TDMCaFYDfyCcjvzfZkECTOE',
    biz_yearly:       'price_1TDMCiFYDfyCcjvzd792JSYe',
  };

  const links = {};
  for (const [key, priceId] of Object.entries(PRICES)) {
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: priceId, quantity: 1 }],
      after_completion: { type: 'redirect', redirect: { url: redirectUrl } },
    });
    links[key] = link.url;
    console.log(key + ':', link.url);
  }

  // 3. Configurer le Customer Portal
  const portalConfig = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'StoreClone AI — Gestion de votre abonnement' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'name'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    },
  });
  console.log('Portal config:', portalConfig.id);

  return res.status(200).json({ links, portalConfigId: portalConfig.id });
}
