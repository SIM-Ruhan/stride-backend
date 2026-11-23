# Stride API

Express 5, Better Auth, and the official MongoDB Node.js driver. The API stores users, sessions and orders. The separate Next.js storefront proxies browser requests to this service.

## Local setup

1. Install Node.js 22.13 or newer. Start MongoDB locally or use a MongoDB Atlas connection string.
2. Copy the example configuration, install dependencies and generate a random secret.

```bash
cp .env.example .env
npm ci
openssl rand -base64 48
```

3. Paste the generated value into `BETTER_AUTH_SECRET`. Set `MONGODB_URI`, `MONGODB_DB` and the merchant's `BDT_PER_USD`. Set `MONGO_TRANSACTIONS=true` for a replica set or Atlas cluster. Use `false` for standalone MongoDB.
4. Run `npm run dev` or `npm start`. The local health endpoint is **http://localhost:8000/api/health**. Start the frontend separately and use **http://localhost:3000** to shop. The frontend and backend must agree on the public storefront origin.
5. Email/password registration and sign-in are available as soon as MongoDB and Better Auth are configured.

## Google login

In Google Cloud Console, configure the Google Auth Platform branding and audience. For an external app in testing, add the Google account you intend to test to its test users. Create a **Web application** OAuth client. Set the authorized JavaScript origin to the storefront origin. Register the following redirect URIs for the environments you use.

```text
http://localhost:3000/api/auth/callback/google
https://YOUR-STOREFRONT-DOMAIN/api/auth/callback/google
```

Put the client ID in `GOOGLE_CLIENT_ID` and the client secret in `GOOGLE_CLIENT_SECRET` on the backend. Set `BETTER_AUTH_URL` to the public storefront origin. Restart the API after changing its environment.

Google credentials: https://console.cloud.google.com/apis/credentials

Better Auth provider guide: https://better-auth.com/docs/authentication/google

## SSLCOMMERZ

Use the store ID and store password from your merchant sandbox account. Set `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, and `SSLCOMMERZ_LIVE=false`. Sandbox and live credentials are separate.

The storefront advertises USD prices. The backend calculates each order in integer cents, converts the total to BDT using the configured merchant rate and stores both totals. The value 120 in the example is an illustrative store rate. Choose pricing before taking payments. This configuration assumes delivery within Bangladesh is included.

For a sandbox or live payment, serve the frontend at a **public HTTPS URL** so the gateway can reach the callback routes. Point its API rewrite to the running backend. Set `BETTER_AUTH_URL` to that HTTPS storefront origin. Configure the merchant IPN listener as:

```text
https://YOUR-STOREFRONT-DOMAIN/api/payment/ipn
```

The server creates the success, failure and cancellation URLs per order. A successful browser return or IPN triggers server-to-server validation. The API checks the provider status, transaction ID, validation ID, currency and amount before recording the payment. High-risk receipts appear as **review**. Duplicate notifications and late failure callbacks preserve a verified order. Each order has an owner and a unique checkout attempt. Customers can see their own payments at `/orders`.

When switching to production, use live merchant credentials, set `SSLCOMMERZ_LIVE=true`, configure the production IPN URL and restart the API. Keep all secrets in backend environment settings.

Merchant API docs: https://developer.sslcommerz.com/doc/v4/

Sandbox registration: https://developer.sslcommerz.com/registration/

## Tests

```bash
npm test
STRIDE_TEST_MONGODB=mongodb://127.0.0.1:27017 npm test
```

The first command runs pricing and receipt validation tests. The second also runs the end-to-end API test with a temporary database, including sign-in, the Google authorization redirect, price checks, and payment returns. Its injected gateway simulates the provider. The test deletes only its own randomly named test database.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/health | Service health |
| GET | /api/store | Google availability and merchant rate |
| POST | /api/quote | Server-priced basket |
| GET/POST | /api/auth/* | Better Auth |
| POST | /api/checkout | Authenticated hosted-payment session |
| POST | /api/payment/success, /api/payment/ipn | Validate a provider receipt |
| POST | /api/payment/fail, /api/payment/cancel | Verify the return token, update the order and redirect |
| GET | /api/orders, /api/orders/:id | Authenticated order history or receipt |

