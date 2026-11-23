import { problem } from './catalog.js';

export function gateway(config) {
  const host = config.live ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
  async function request(path, params, method) {
    if (!config.storeId || !config.storePassword)
      throw problem(503, 'Payment credentials have not been configured.');
    const data = new URLSearchParams({
      ...params,
      store_id: config.storeId,
      store_passwd: config.storePassword,
      format: 'json',
    });
    const url = new URL(path, host);
    if (method === 'GET') url.search = data.toString();
    let response;
    try {
      response = await fetch(url, {
        method,
        body: method === 'POST' ? data : undefined,
        signal: AbortSignal.timeout(18000),
        redirect: 'error',
      });
      if (response.ok) return await response.json();
    } catch {
      /* Network failures leave an order available for a later notification. */
    }
    throw problem(502, 'SSLCOMMERZ is temporarily unavailable.');
  }
  return {
    async start(order) {
      const s = order.shipping;
      const callback = config.site + '/api/payment/';
      const suffix = '?order=' + order._id + '&token=' + order.returnToken;
      const data = await request(
        '/gwprocess/v4/api.php',
        {
          total_amount: (order.bdtPaisa / 100).toFixed(2),
          currency: 'BDT',
          tran_id: order._id,
          success_url: callback + 'success' + suffix,
          fail_url: callback + 'fail' + suffix,
          cancel_url: callback + 'cancel' + suffix,
          ipn_url: callback + 'ipn',
          cus_name: s.name,
          cus_email: order.email,
          cus_add1: s.address,
          cus_city: s.city,
          cus_state: s.city,
          cus_postcode: s.postcode,
          cus_country: 'Bangladesh',
          cus_phone: s.phone,
          shipping_method: 'YES',
          ship_name: s.name,
          ship_add1: s.address,
          ship_area: s.area,
          ship_city: s.city,
          ship_sub_city: s.area,
          ship_postcode: s.postcode,
          ship_country: 'Bangladesh',
          num_of_item: order.items.length,
          product_name: 'Stride plant protein bars',
          product_category: 'Food',
          product_profile: 'physical-goods',
        },
        'POST',
      );
      if (data.status !== 'SUCCESS' || !data.GatewayPageURL)
        throw problem(502, 'SSLCOMMERZ could not open a payment session.');
      const target = new URL(data.GatewayPageURL);
      if (target.protocol !== 'https:' || !/(^|\.)sslcommerz\.com$/.test(target.hostname))
        throw problem(502, 'Unexpected payment destination.');
      return target.href;
    },
    validate(valId) {
      return request('/validator/api/validationserverAPI.php', { val_id: valId, v: 1 }, 'GET');
    },
  };
}

export function verifiedStatus(order, data, valId) {
  if (
    !['VALID', 'VALIDATED'].includes(data.status) ||
    data.tran_id !== order._id ||
    data.val_id !== valId ||
    data.currency !== 'BDT' ||
    Math.round(Number(data.amount) * 100) !== order.bdtPaisa
  ) {
    throw problem(422, 'Payment could not be verified.');
  }
  return String(data.risk_level) === '0' ? 'paid' : 'review';
}
