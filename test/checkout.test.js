import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { quote } from '../src/catalog.js';
import { verifiedStatus } from '../src/gateway.js';
import { createApp } from '../src/app.js';

const items = [
  { id: 'sample-pack-1', kind: 'pack', flavours: [1, 2, 3] },
  { id: 'sample-bag-2', kind: 'bag', flavours: [4] },
];
test('the server prices the three-pack and single bag', () => {
  assert.equal(quote(items, 120).usdCents, 1047);
  assert.equal(quote(items, 120).bdtPaisa, 125640);
  assert.throws(() => quote([{ ...items[0], flavours: [1, 2] }], 120));
  assert.throws(() => quote([items[0], items[0]], 120));
});
test('a payment must match the stored amount, currency and transaction', () => {
  const order = { _id: 'test', bdtPaisa: 89760 };
  const valid = {
    status: 'VALID',
    currency: 'BDT',
    amount: '897.60',
    tran_id: 'test',
    val_id: 'validation',
    risk_level: '0',
  };
  assert.equal(verifiedStatus(order, valid, 'validation'), 'paid');
  assert.equal(verifiedStatus(order, { ...valid, risk_level: '1' }, 'validation'), 'review');
  for (const changes of [
    { amount: '7.48' },
    { currency: 'USD' },
    { tran_id: 'different' },
    { val_id: 'different' },
    { status: 'INVALID' },
  ])
    assert.throws(() => verifiedStatus(order, { ...valid, ...changes }, 'validation'));
});

test(
  'MongoDB, Better Auth and hosted payment callbacks',
  { skip: !process.env.STRIDE_TEST_MONGODB },
  async (t) => {
    const client = new MongoClient(process.env.STRIDE_TEST_MONGODB);
    await client.connect();
    const db = client.db('stride_test_' + randomBytes(8).toString('hex'));
    let server;
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.dropDatabase();
      await client.close();
    });
    const config = {
      site: 'http://localhost:3000',
      secret: randomBytes(40).toString('hex'),
      rate: 120,
      googleId: 'local-test-client',
      googleSecret: 'local-test-secret',
    };
    let captures = 0,
      receipt,
      stored;
    const payments = {
      async start(order) {
        captures++;
        stored = order;
        return 'https://sandbox.sslcommerz.com/test-session';
      },
      async validate() {
        return receipt;
      },
    };
    const app = await createApp({ db, client, config, payments });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const post = (path, body, cookie = '') =>
      fetch(origin + '/api/' + path, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', origin: config.site, cookie },
        body: JSON.stringify(body),
      });
    const creds = { email: 'test@example.com', name: 'Test Buyer', password: 'stride-demo-password' };
    const reg = await post('auth/sign-up/email', creds);
    assert.equal(reg.status, 200, await reg.clone().text());
    const login = await post('auth/sign-in/email', { email: creds.email, password: creds.password });
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert.equal(login.status, 200);
    assert.ok(cookie);
    const google = await post('auth/sign-in/social', {
      provider: 'google',
      callbackURL: config.site + '/orders',
      disableRedirect: true,
    });
    assert.equal(google.status, 200);
    assert.equal(
      new URL((await google.json()).url).searchParams.get('redirect_uri'),
      config.site + '/api/auth/callback/google',
    );
    const req = {
      attempt: randomUUID(),
      items,
      expectedPaisa: 125640,
      shipping: {
        name: 'Test Buyer',
        address: 'Road 1',
        area: 'Bashundhara',
        city: 'Dhaka',
        postcode: '1229',
        phone: '01700000000',
      },
    };
    assert.equal((await post('checkout', req)).status, 401);
    assert.equal((await post('checkout', { ...req, expectedPaisa: 10 }, cookie)).status, 409);
    const check = await post('checkout', req, cookie);
    assert.equal(check.status, 200, await check.clone().text());
    const { id } = await check.json();
    assert.equal((await post('checkout', req, cookie)).status, 200);
    assert.equal(captures, 1);
    assert.equal((await post('payment/cancel?order=' + id + '&token=bad', { tran_id: id })).status, 403);
    assert.equal(
      (await post('payment/cancel?order=' + id + '&token=' + stored.returnToken, { tran_id: id })).status,
      303,
    );
    let found = await db.collection('orders').findOne({ _id: id });
    assert.equal(found.status, 'cancelled');
    receipt = {
      status: 'VALID',
      amount: '1',
      currency: 'BDT',
      tran_id: id,
      val_id: 'example',
      risk_level: '0',
    };
    const callback = { tran_id: id, val_id: 'example' };
    assert.equal((await post('payment/ipn', callback)).status, 422);
    receipt.amount = '1256.40';
    assert.equal((await post('payment/success', callback)).status, 303);
    assert.equal((await post('payment/ipn', callback)).status, 200);
    assert.equal(
      (await post('payment/fail?order=' + id + '&token=' + stored.returnToken, { tran_id: id })).status,
      303,
    );
    found = await db.collection('orders').findOne({ _id: id });
    assert.equal(found.status, 'paid');
    const history = await fetch(origin + '/api/orders', { headers: { cookie } });
    assert.equal((await history.json())[0].id, id);
    const other = await post('auth/sign-up/email', { ...creds, email: 'other@example.com' });
    const otherCookie = other.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert.equal(
      (await fetch(origin + '/api/orders/' + id, { headers: { cookie: otherCookie } })).status,
      404,
    );
  },
);
