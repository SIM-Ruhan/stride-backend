import { MongoClient } from 'mongodb';
import { createApp } from './app.js';

const env = process.env;
if (!env.MONGODB_URI || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
  throw new Error('Set MONGODB_URI and a random BETTER_AUTH_SECRET of at least 32 characters.');
const site = new URL(env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
const rate = Number(env.BDT_PER_USD);
if (!Number.isFinite(rate) || rate <= 0 || rate > 10000)
  throw new Error('Set a positive merchant BDT_PER_USD.');
const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const app = await createApp({
  db: client.db(env.MONGODB_DB || 'stride'),
  client,
  config: {
    site,
    rate,
    secret: env.BETTER_AUTH_SECRET,
    transactions: env.MONGO_TRANSACTIONS === 'true',
    googleId: env.GOOGLE_CLIENT_ID,
    googleSecret: env.GOOGLE_CLIENT_SECRET,
    live: env.SSLCOMMERZ_LIVE === 'true',
    storeId: env.SSLCOMMERZ_STORE_ID,
    storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
  },
});

for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(async () => {
      await client.close();
      process.exit(0);
    }),
  );
