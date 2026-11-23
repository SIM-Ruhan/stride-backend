// stride-backend/index.js
import express from "express";
import { MongoClient } from "mongodb";
import { createApp } from "./src/app.js";

const app = express();
app.disable("x-powered-by");

let applicationPromise;

async function initializeApplication() {
  const env = process.env;

  if (!env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing.");
  }

  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }

  if (!env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL must contain your frontend origin.");
  }

  const site = new URL(env.BETTER_AUTH_URL).origin;
  const rate = Number(env.BDT_PER_USD);

  if (!Number.isFinite(rate) || rate <= 0 || rate > 10000) {
    throw new Error("BDT_PER_USD must be between 0 and 10000.");
  }

  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });

  try {
    await client.connect();

    return await createApp({
      db: client.db(env.MONGODB_DB || "stride"),
      client,
      config: {
        site,
        rate,
        secret: env.BETTER_AUTH_SECRET,
        transactions: env.MONGO_TRANSACTIONS === "true",
        googleId: env.GOOGLE_CLIENT_ID,
        googleSecret: env.GOOGLE_CLIENT_SECRET,
        live: env.SSLCOMMERZ_LIVE === "true",
        storeId: env.SSLCOMMERZ_STORE_ID,
        storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
      },
    });
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

function getApplication() {
  if (!applicationPromise) {
    applicationPromise = initializeApplication().catch((error) => {
      applicationPromise = undefined;
      throw error;
    });
  }

  return applicationPromise;
}

// Forward the original request so Better Auth can read its body.
app.use(async (req, res, next) => {
  try {
    const application = await getApplication();
    application(req, res, next);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error("Stride backend initialization failed:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Backend initialization failed. Check the Vercel runtime logs.",
  });
});

export default app;