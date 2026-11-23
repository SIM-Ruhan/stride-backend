import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { quote, shipping, problem } from './catalog.js';
import { gateway, verifiedStatus } from './gateway.js';

export async function createApp({ db, client, config, payments = gateway(config) }) {
  const auth = betterAuth({
    appName: 'Stride',
    baseURL: config.site,
    secret: config.secret,
    trustedOrigins: [config.site],
    database: mongodbAdapter(db, config.transactions ? { client } : { transaction: false }),
    emailAndPassword: { enabled: true },
    socialProviders:
      config.googleId && config.googleSecret
        ? { google: { clientId: config.googleId, clientSecret: config.googleSecret } }
        : {},
  });
  const orders = db.collection('orders');
  await orders.createIndex({ userId: 1, attempt: 1 }, { unique: true });
  await orders.createIndex({ userId: 1, createdAt: -1 });
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json({ limit: '32kb' }), express.urlencoded({ extended: false, limit: '32kb' }));
  app.get('/api/store', (_req, res) =>
    res.json({ google: Boolean(config.googleId && config.googleSecret), rate: config.rate }),
  );
  app.post('/api/quote', (req, res) => res.json(quote(req.body?.items, config.rate)));

  async function member(req, _res, next) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw problem(401, 'Sign in to continue.');
    req.member = session.user;
    next();
  }
  const publicOrder = ({ _id, items, usdCents, bdtPaisa, rate, status, createdAt }) => ({
    id: _id,
    items,
    usdCents,
    bdtPaisa,
    rate,
    status,
    createdAt,
  });
  app.get('/api/orders', member, async (req, res) => {
    const found = await orders.find({ userId: req.member.id }).sort({ createdAt: -1 }).limit(100).toArray();
    res.json(found.map(publicOrder));
  });
  app.get('/api/orders/:id', member, async (req, res) => {
    const order = await orders.findOne({ _id: req.params.id, userId: req.member.id });
    if (!order) throw problem(404, 'Order unavailable.');
    res.json(publicOrder(order));
  });
  app.post('/api/checkout', member, async (req, res) => {
    if (req.get('origin') !== config.site) throw problem(403, 'Unrecognised checkout origin.');
    const { attempt, expectedPaisa } = req.body;
    if (typeof attempt !== 'string' || !/^[\da-f-]{36}$/i.test(attempt))
      throw problem(400, 'Invalid checkout reference.');
    const cart = quote(req.body.items, config.rate);
    if (expectedPaisa !== cart.bdtPaisa)
      throw problem(409, 'The total changed. Refresh your basket before paying.');
    const address = shipping(req.body.shipping);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([cart, address]))
      .digest('hex');
    const order = {
      _id: 'ST' + randomBytes(12).toString('hex'),
      userId: req.member.id,
      email: req.member.email,
      ...cart,
      shipping: address,
      attempt,
      fingerprint,
      status: 'starting',
      createdAt: new Date(),
      returnToken: randomBytes(24).toString('hex'),
    };
    try {
      await orders.insertOne(order);
    } catch (error) {
      if (error.code !== 11000) throw error;
      const prior = await orders.findOne({ userId: order.userId, attempt });
      if (!prior || prior.fingerprint !== fingerprint)
        throw problem(409, 'Start a new checkout for this basket.');
      if (prior.status === 'pending') return res.json({ id: prior._id, url: prior.gatewayURL });
      if (['paid', 'review'].includes(prior.status))
        return res.json({ id: prior._id, url: config.site + '/orders?id=' + prior._id });
      if (prior.status === 'starting' && Date.now() - prior.createdAt.getTime() < 40000)
        throw problem(409, 'Payment is opening. Try again shortly.');
      return res.status(409).json({ error: 'Start a new payment attempt.', renew: true });
    }
    try {
      const url = await payments.start(order);
      await orders.updateOne(
        { _id: order._id, status: 'starting' },
        { $set: { status: 'pending', gatewayURL: url } },
      );
      res.json({ id: order._id, url });
    } catch (error) {
      await orders.updateOne({ _id: order._id, status: 'starting' }, { $set: { status: 'unavailable' } });
      throw error;
    }
  });

  app.post('/api/payment/:event', async (req, res) => {
    const event = req.params.event;
    if (!['success', 'ipn', 'cancel', 'fail'].includes(event)) throw problem(404, 'Unknown callback.');
    const id = req.body.tran_id || req.query.order;
    if (typeof id !== 'string' || !/^ST[\da-f]{24}$/.test(id)) throw problem(400, 'Invalid order.');
    const order = await orders.findOne({ _id: id });
    if (!order) throw problem(404, 'Unknown order.');
    if (event === 'success' || event === 'ipn') {
      const valId = req.body.val_id;
      if (typeof valId !== 'string' || !valId || valId.length > 128) {
        if (event === 'success') return res.redirect(303, config.site + '/orders?id=' + id);
        throw problem(422, 'Missing validation reference.');
      }
      const result = await payments.validate(valId);
      const status = verifiedStatus(order, result, valId);
      await orders.updateOne(
        { _id: id, status: { $nin: ['paid', 'review'] } },
        { $set: { status, valId, verifiedAt: new Date() } },
      );
      if (event === 'ipn') return res.sendStatus(200);
    } else {
      if (req.query.token !== order.returnToken || req.query.order !== id)
        throw problem(403, 'Invalid return token.');
      await orders.updateOne(
        { _id: id, status: { $in: ['pending', 'starting'] } },
        { $set: { status: event === 'cancel' ? 'cancelled' : 'failed' } },
      );
    }
    res.redirect(303, config.site + '/orders?id=' + id);
  });
  app.use((err, _req, res, _next) => {
    const status = Number(err.status) || 500;
    if (status === 500) console.error('Request failed:', err.name);
    res.status(status).json({ error: status === 500 ? 'The request could not be completed.' : err.message });
  });
  return app;
}
