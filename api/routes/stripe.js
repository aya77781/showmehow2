const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const users = require('../db/users');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:3000').trim();

// ── Setup: Create Stripe products + prices + webhook (run once) ──────
router.post('/setup', async (req, res) => {
  try {
    const { webhookUrl } = req.body || {};
    const result = {};

    const PACK10_NAME = 'ShowMe AI — Pack 10 Videos';
    const PACK20_NAME = 'ShowMe AI — Pack 20 Videos';

    const existingProducts = await stripe.products.list({ limit: 100 });
    const pack10Exists = existingProducts.data.find(p => p.name === PACK10_NAME && p.active);
    const pack20Exists = existingProducts.data.find(p => p.name === PACK20_NAME && p.active);

    const pack10Product = pack10Exists || await stripe.products.create({
      name: PACK10_NAME,
      description: '10 AI video tutorials with real screenshots and narration',
    });
    const pack20Product = pack20Exists || await stripe.products.create({
      name: PACK20_NAME,
      description: '20 AI video tutorials with real screenshots and narration',
    });

    const allPrices = await stripe.prices.list({ limit: 100, active: true });
    let pack10Price = allPrices.data.find(p => p.product === pack10Product.id && p.unit_amount === 500 && !p.recurring);
    let pack20Price = allPrices.data.find(p => p.product === pack20Product.id && p.unit_amount === 1000 && !p.recurring);

    if (!pack10Price) {
      pack10Price = await stripe.prices.create({
        product: pack10Product.id,
        unit_amount: 500,
        currency: 'eur',
      });
    }
    if (!pack20Price) {
      pack20Price = await stripe.prices.create({
        product: pack20Product.id,
        unit_amount: 1000,
        currency: 'eur',
      });
    }

    result.STRIPE_PRICE_PACK10 = pack10Price.id;
    result.STRIPE_PRICE_PACK20 = pack20Price.id;
    result.products = (pack10Exists && pack20Exists) ? 'Already exist (reused)' : 'Created';

    if (webhookUrl) {
      const webhookEvents = [
        'checkout.session.completed',
      ];

      const existingWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
      const existing = existingWebhooks.data.find(wh => wh.url === webhookUrl && wh.status === 'enabled');

      if (existing) {
        await stripe.webhookEndpoints.update(existing.id, { enabled_events: webhookEvents });
        result.webhook = { id: existing.id, url: webhookUrl, status: 'Updated' };
        result.STRIPE_WEBHOOK_SECRET = '(use existing secret from .env)';
      } else {
        const webhook = await stripe.webhookEndpoints.create({
          url: webhookUrl,
          enabled_events: webhookEvents,
        });
        result.webhook = { id: webhook.id, url: webhookUrl, status: 'Created' };
        result.STRIPE_WEBHOOK_SECRET = webhook.secret;
      }
    } else {
      result.webhook = 'No webhookUrl provided. For local dev use: stripe listen --forward-to localhost:5000/api/webhook';
    }

    res.json({ message: 'Stripe setup complete! Add these to your .env:', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pack credit mapping (single source of truth) ───────────
const PACKS = {
  pack10: { credits: 10, amount: 500, label: 'Pack 10 Videos', priceEnv: 'STRIPE_PRICE_PACK10' },
  pack20: { credits: 20, amount: 1000, label: 'Pack 20 Videos', priceEnv: 'STRIPE_PRICE_PACK20' },
};

// ── Get pricing info ───────────────────────────────────────
router.get('/prices', (req, res) => {
  res.json({
    pack10: { price: 5.00, currency: 'eur', credits: 10, label: 'Pack 10 Videos', priceId: process.env.STRIPE_PRICE_PACK10 },
    pack20: { price: 10.00, currency: 'eur', credits: 20, label: 'Pack 20 Videos', priceId: process.env.STRIPE_PRICE_PACK20 },
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

// ── Get user plan status ───────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const user = await users.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const unlimited = users.hasUnlimitedAccess(user);
    const credits = unlimited ? 9999 : (user.credits || 0);
    const canGenerate = unlimited || credits > 0;
    const isPaid = unlimited || (user.plan && user.plan !== 'free');

    res.json({
      plan: unlimited ? 'unlimited' : (user.plan || 'free'),
      credits,
      isPaid,
      canGenerate,
      canMakePrivate: isPaid,
    });
  } catch (err) {
    console.error('Stripe status error:', err);
    res.status(500).json({ error: 'Failed to get plan status' });
  }
});

// ── Create checkout session ────────────────────────────────
router.post('/checkout', auth, async (req, res) => {
  try {
    const { plan } = req.body;
    const pack = PACKS[plan];
    if (!pack) return res.status(400).json({ error: 'Invalid plan' });

    let user = await users.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      user = await users.update(user.id, { stripe_customer_id: customerId });
    }

    const priceId = (process.env[pack.priceEnv] || '').trim();
    if (!priceId) return res.status(500).json({ error: `${pack.priceEnv} not configured. Run /api/stripe/setup first.` });

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      metadata: { userId: user.id, plan, credits: String(pack.credits) },
      success_url: `${CLIENT_URL}/dashboard?payment=success&plan=${plan}`,
      cancel_url: `${CLIENT_URL}/pricing?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

module.exports = router;
module.exports.PACKS = PACKS;
