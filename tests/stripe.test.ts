import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signStripePayload, subscriptionFields, subscriptionIdOf, verifyStripeSignature } from '../supabase/functions/_shared/stripe.ts';

const SECRET = 'whsec_test';
const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', created: 1760000000, data: { object: { id: 'sub_1' } } });

test('webhook : signature valide, altérée, expirée ou absente', async () => {
  const now = 1760000100;
  const h = await signStripePayload(body, SECRET, now - 10);
  assert.equal(await verifyStripeSignature(body, h, SECRET, now), true);
  assert.equal(await verifyStripeSignature(body + ' ', h, SECRET, now), false, 'contenu modifié');
  assert.equal(await verifyStripeSignature(body, h, 'whsec_autre', now), false, 'mauvais secret');
  assert.equal(await verifyStripeSignature(body, h, SECRET, now + 3600), false, 'rejeu au-delà de 5 minutes');
  assert.equal(await verifyStripeSignature(body, null, SECRET, now), false);
  assert.equal(await verifyStripeSignature(body, `${h.split(',')[0]},v1=deadbeef,${h.split(',')[1]}`, SECRET, now), true, 'plusieurs signatures (rotation du secret)');
});

test('abonnement Stripe → ligne d’abonnement (offre, fin de période, résiliation programmée)', () => {
  const f = subscriptionFields({
    id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, canceled_at: null,
    items: { data: [{ price: { id: 'price_m' }, current_period_end: 1767225600 }] },
  }, { price_m: 'mensuel' }, 1760000000);
  assert.equal(f.status, 'active');
  assert.equal(f.plan_code, 'mensuel');
  assert.equal(f.current_period_end, '2026-01-01T00:00:00.000Z');
  assert.equal(f.cancel_at_period_end, true);
  assert.equal(f.stripe_updated_at, 1760000000);
  assert.equal(subscriptionFields({ id: 's', customer: 'c', status: 'bizarre', cancel_at_period_end: false, canceled_at: null }, {}, 1).status, 'incomplete');
});

test('événements : abonnement concerné', () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ id: 'e', type, created: 1, data: { object } });
  assert.equal(subscriptionIdOf(ev('customer.subscription.deleted', { id: 'sub_9' })), 'sub_9');
  assert.equal(subscriptionIdOf(ev('checkout.session.completed', { subscription: 'sub_2' })), 'sub_2');
  assert.equal(subscriptionIdOf(ev('invoice.payment_failed', { subscription: 'sub_3' })), 'sub_3');
  assert.equal(subscriptionIdOf(ev('invoice.paid', { parent: { subscription_details: { subscription: 'sub_4' } } })), 'sub_4', 'format récent des factures');
  assert.equal(subscriptionIdOf(ev('charge.refunded', { id: 'ch_1' })), null);
});
