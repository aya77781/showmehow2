const express = require('express');
const router = express.Router();
const users = require('../db/users');
const { PACKS } = require('./stripe');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Stripe webhook — raw body required
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;
      const pack = PACKS?.[plan];

      if (userId && pack && session.mode === 'payment') {
        await users.incrementCredits(userId, pack.credits);
        await users.update(userId, { plan });
        console.log(`[Stripe] User ${userId}: +${pack.credits} credits (${plan})`);
      }
    }
  } catch (err) {
    console.error(`[Stripe] Webhook handler error for ${event.type}:`, err);
  }

  res.json({ received: true });
});

module.exports = router;
