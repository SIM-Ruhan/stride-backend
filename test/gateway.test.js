import assert from 'node:assert/strict';
import test from 'node:test';
import { gateway } from '../src/gateway.js';

test('hosted checkout and validation use the merchant protocol', async (t) => {
  const store = gateway({
    site: 'https://stride.example',
    storeId: 'test',
    storePassword: 'sample',
    live: false,
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    const data =
      options.method === 'POST'
        ? { status: 'SUCCESS', GatewayPageURL: 'https://sandbox.sslcommerz.com/EasyCheckOut/test' }
        : {
            status: 'VALID',
            tran_id: 'STsample',
            val_id: 'sample-receipt',
            amount: '897.60',
            currency: 'BDT',
            risk_level: '0',
          };
    return Response.json(data);
  });
  const order = {
    _id: 'STsample',
    bdtPaisa: 89760,
    email: 'buyer@example.com',
    returnToken: 'sample-token',
    items: [{ kind: 'pack' }],
    shipping: {
      name: 'Buyer',
      address: 'Road 1',
      city: 'Dhaka',
      area: 'Bashundhara',
      postcode: '1229',
      phone: '01700000000',
    },
  };
  assert.match(await store.start(order), /^https:\/\/sandbox\.sslcommerz\.com\//);
  const fields = calls[0].options.body;
  assert.equal(calls[0].url.pathname, '/gwprocess/v4/api.php');
  assert.equal(fields.get('tran_id'), order._id);
  assert.equal(fields.get('total_amount'), '897.60');
  assert.equal(fields.get('currency'), 'BDT');
  assert.equal(fields.get('ipn_url'), 'https://stride.example/api/payment/ipn');
  assert.equal(new URL(fields.get('cancel_url')).searchParams.get('token'), order.returnToken);
  const verified = await store.validate('sample-receipt');
  assert.equal(verified.status, 'VALID');
  assert.equal(calls[1].url.pathname, '/validator/api/validationserverAPI.php');
  assert.equal(calls[1].url.searchParams.get('val_id'), 'sample-receipt');
});
