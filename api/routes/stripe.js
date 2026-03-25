const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// ── Setup: Create Stripe products + prices + webhook (run once) ──────
router.post('/setup', async (req, res) => {
  try {
    const { webhookUrl } = req.body || {};
    const result = {};

    // Check if products already exist
    const existingProducts = await stripe.products.list({ limit: 100 });
    const singleExists = existingProducts.data.find(p => p.name === 'ShowMe AI — Single Tutorial' && p.active);
    const proExists = existingProducts.data.find(p => p.name === 'ShowMe AI — Pro Monthly' && p.active);

    if (singleExists && proExists) {
      const prices = await stripe.prices.list({ limit: 100, active: true });
      const singlePrice = prices.data.find(p => p.product === singleExists.id);
      const proPrice = prices.data.find(p => p.product === proExists.id && p.recurring);
      result.STRIPE_PRICE_SINGLE = singlePrice?.id || 'NOT_FOUND';
      result.STRIPE_PRICE_PRO = proPrice?.id || 'NOT_FOUND';
      result.products = 'Already exist (skipped)';
    } else {
      const singleProduct = singleExists || await stripe.products.create({
        name: 'ShowMe AI — Single Tutorial',
        description: 'Generate one AI video tutorial with real screenshots and narration',
      });
      const singlePrice = await stripe.prices.create({
        product: singleProduct.id,
        unit_amount: 600,
        currency: 'eur',
      });

      const proProduct = proExists || await stripe.products.create({
        name: 'ShowMe AI — Pro Monthly',
        description: 'Unlimited AI video tutorials per month',
      });
      const proPrice = await stripe.prices.create({
        product: proProduct.id,
        unit_amount: 1200,
        currency: 'eur',
        recurring: { interval: 'month' },
      });

      result.STRIPE_PRICE_SINGLE = singlePrice.id;
      result.STRIPE_PRICE_PRO = proPrice.id;
      result.products = 'Created';
    }

    // Create webhook endpoint if production URL provided
    if (webhookUrl) {
      const webhookEvents = [
        'checkout.session.completed',
        'invoice.paid',
        'customer.subscription.deleted',
      ];

      // Check for existing webhook with same URL
      const existingWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
      const existing = existingWebhooks.data.find(wh => wh.url === webhookUrl && wh.status === 'enabled');

      if (existing) {
        // Update events if needed
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

// ── Get pricing info ───────────────────────────────────────
router.get('/prices', (req, res) => {
  res.json({
    single: { price: 6.00, currency: 'eur', label: 'Single Tutorial', priceId: process.env.STRIPE_PRICE_SINGLE },
    pro: { price: 12.00, currency: 'eur', label: 'Pro Monthly', priceId: process.env.STRIPE_PRICE_PRO },
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

// ── Get user plan status ───────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isPro = user.plan === 'pro' && user.planExpiresAt && user.planExpiresAt > new Date();
    const canGenerate = isPro || user.credits > 0;
    const isPaid = isPro || user.plan === 'single';

    res.json({
      plan: isPro ? 'pro' : (user.plan === 'single' ? 'single' : 'free'),
      credits: user.credits,
      isPro,
      isPaid,
      canGenerate,
      canMakePrivate: isPaid,
      planExpiresAt: user.planExpiresAt,
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
    if (plan !== 'single' && plan !== 'pro') return res.status(400).json({ error: 'Invalid plan' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_SINGLE;
    const mode = plan === 'pro' ? 'subscription' : 'payment';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      metadata: { userId: user._id.toString(), plan },
      success_url: `${CLIENT_URL}/dashboard?payment=success&plan=${plan}`,
      cancel_url: `${CLIENT_URL}/pricing?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ── Customer portal (manage subscription) ──────────────────
router.post('/portal', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user?.stripeCustomerId) return res.status(400).json({ error: 'No subscription' });

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${CLIENT_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe portal error:', err);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

module.exports = router;
