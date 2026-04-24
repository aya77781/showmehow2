const express = require('express');
const router = express.Router();
const users = require('../db/users');
const { PACKS } = require('./stripe');
const supabase = require('../config/supabase');
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

  // Idempotence: skip if we've already processed this Stripe event id.
  // Inserting first guarantees a duplicate retry will conflict on the PK.
  const { error: claimErr } = await supabase
    .from('processed_webhook_events')
    .insert({ event_id: event.id, event_type: event.type });

  if (claimErr) {
    if (claimErr.code === '23505') {
      console.log(`[Stripe] Skipping duplicate event ${event.id}`);
      return res.json({ received: true, duplicate: true });
    }
    console.error('[Stripe] Failed to record webhook event:', claimErr);
    return res.status(500).json({ error: 'Could not record event' });
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
        await supabase
          .from('processed_webhook_events')
          .update({ user_id: userId, credits_granted: pack.credits })
          .eq('event_id', event.id);
        console.log(`[Stripe] User ${userId}: +${pack.credits} credits (${plan})`);
      }
    }
  } catch (err) {
    console.error(`[Stripe] Webhook handler error for ${event.type}:`, err);
    // Drop the idempotence row so a retry can re-attempt grant.
    await supabase.from('processed_webhook_events').delete().eq('event_id', event.id);
    return res.status(500).json({ error: err.message });
  }

  res.json({ received: true });
});

module.exports = router;
