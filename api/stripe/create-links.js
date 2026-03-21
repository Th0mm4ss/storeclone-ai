// ENDPOINT TEMPORAIRE — à supprimer après usage
import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
  const redirectUrl = 'https://storeclone-ai.vercel.app/app.html?payment=success';

  // Désactiver les anciens payment links actifs
  const existing = await stripe.paymentLinks.list({ limit: 20 });
  for (const link of existing.data) {
    if (link.active) {
      await stripe.paymentLinks.update(link.id, { active: false });
      console.log('Désactivé:', link.id);
    }
  }

  // Créer Pro avec redirection
  const pro = await stripe.paymentLinks.create({
    line_items: [{ price: 'price_1TDCSQFYDfyCcjvzGJVEYOQB', quantity: 1 }],
    after_completion: { type: 'redirect', redirect: { url: redirectUrl } },
  });

  // Créer Business avec redirection
  const business = await stripe.paymentLinks.create({
    line_items: [{ price: 'price_1TDCSaFYDfyCcjvz4u27klDM', quantity: 1 }],
    after_completion: { type: 'redirect', redirect: { url: redirectUrl } },
  });

  console.log('Pro:', pro.url);
  console.log('Business:', business.url);

  return res.status(200).json({ pro: pro.url, business: business.url });
}
