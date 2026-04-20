const express = require('express');
const router = express.Router();
const users = require('../db/users');
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
    switch (event.type) {
      // ── One-time payment completed ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;

        if (!userId) break;

        if (plan === 'single' && session.mode === 'payment') {
          await users.incrementCredits(userId, 1);
          await users.update(userId, { plan: 'single' });
          console.log(`[Stripe] User ${userId}: +1 credit (single tutorial)`);
        }

        if (plan === 'pro' && session.mode === 'subscription') {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          if (subscription) {
            await users.update(userId, {
              plan: 'pro',
              stripe_subscription_id: session.subscription,
              plan_expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
            });
            console.log(`[Stripe] User ${userId}: Pro subscription activated`);
          }
        }
        break;
      }

      // ── Subscription renewed ──
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const customer = await stripe.customers.retrieve(invoice.customer);
          const userId = customer?.metadata?.userId;
          if (userId && subscription) {
            await users.update(userId, {
              plan: 'pro',
              plan_expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
            });
            console.log(`[Stripe] User ${userId}: Pro renewed`);
          }
        }
        break;
      }

      // ── Subscription cancelled ──
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customer = await stripe.customers.retrieve(subscription.customer);
        const userId = customer?.metadata?.userId;
        if (userId) {
          await users.update(userId, {
            plan: 'free',
            stripe_subscription_id: null,
            plan_expires_at: null,
          });
          console.log(`[Stripe] User ${userId}: Subscription cancelled`);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[Stripe] Webhook handler error for ${event.type}:`, err);
  }

  res.json({ received: true });
});

module.exports = router;
