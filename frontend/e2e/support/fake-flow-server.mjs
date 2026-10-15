// Fake Flow gateway for the payment e2e (issue #419, point 2). Started by
// Playwright's `webServer` (frontend/playwright.config.ts). The backend talks to
// it because it runs with FLOW_API_BASE_URL=http://127.0.0.1:4010.
//
// It replays only the parts of Flow that Umbral uses, with the same contract as
// backend/src/modules/payments/flow-gateway.client.ts:
//   POST /payment/create     signed form body -> { flowOrder, url, token }
//   GET  /payment/getStatus  signed query     -> { status, flowOrder, amount }
//   GET  /pay?token=         the "hosted checkout" page with a pay button
//   POST /pay?token=         pays the order, POSTs the token to urlConfirmation
//                            (server to server) and then POSTs the browser to
//                            urlReturn, like the real Flow does
//   GET  /__orders           test-only: what the backend sent and received
//
// Requests are rejected with 401 unless they carry the HMAC-SHA256 signature
// computed with the fake secret, so the e2e also proves the backend decrypts the
// seeded credentials and signs correctly. Flow status codes: 1 pending, 2 paid.
//
// The defaults match backend/prisma/seed-e2e.ts (FLOW_API_KEY / FLOW_SECRET_KEY).
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const PORT = Number(process.env.FAKE_FLOW_PORT || 4010);
const API_KEY = process.env.E2E_FLOW_API_KEY || 'e2e-flow-api-key';
const SECRET_KEY = process.env.E2E_FLOW_SECRET_KEY || 'e2e-flow-secret-key';
const PUBLIC_URL = `http://127.0.0.1:${PORT}`;

const FLOW_STATUS_PENDING = 1;
const FLOW_STATUS_PAID = 2;

/** token -> order. In memory: the process lives as long as the test run. */
const orders = new Map();

function sign(params) {
  const toSign = Object.keys(params)
    .filter((key) => key !== 's')
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  return createHmac('sha256', SECRET_KEY).update(toSign).digest('hex');
}

function isSigned(params) {
  return params.apiKey === API_KEY && params.s === sign(params);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function createOrder(req, res) {
  const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
  if (!isSigned(params)) {
    return sendJson(res, 401, { code: 105, message: 'Invalid signature' });
  }
  const token = `E2E${(orders.size + 1).toString().padStart(4, '0')}${Date.now().toString(36)}`;
  orders.set(token, {
    token,
    flowOrder: 9000 + orders.size + 1,
    commerceOrder: params.commerceOrder,
    amount: Number(params.amount),
    currency: params.currency,
    payerEmail: params.email,
    subject: params.subject,
    urlConfirmation: params.urlConfirmation,
    urlReturn: params.urlReturn,
    status: FLOW_STATUS_PENDING,
    confirmation: null,
  });
  sendJson(res, 200, {
    flowOrder: orders.get(token).flowOrder,
    url: `${PUBLIC_URL}/pay`,
    token,
  });
}

function getStatus(url, res) {
  const params = Object.fromEntries(url.searchParams);
  if (!isSigned(params)) {
    return sendJson(res, 401, { code: 105, message: 'Invalid signature' });
  }
  const order = orders.get(params.token);
  if (!order) {
    return sendJson(res, 400, { code: 1700, message: 'Token not found' });
  }
  sendJson(res, 200, {
    status: order.status,
    flowOrder: order.flowOrder,
    amount: order.amount,
  });
}

function payPage(url, res) {
  const token = url.searchParams.get('token') ?? '';
  const order = orders.get(token);
  if (!order) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Unknown order');
  }
  sendHtml(
    res,
    `<!doctype html><html lang="es"><meta charset="utf-8"><title>Flow (simulado)</title>` +
      `<body><h1>Flow simulado</h1>` +
      `<p>Monto a pagar: <strong>${escapeHtml(order.amount)}</strong> ${escapeHtml(order.currency)}</p>` +
      `<form method="POST" action="/pay?token=${encodeURIComponent(token)}">` +
      `<button type="submit">Pagar</button></form></body></html>`,
  );
}

async function pay(url, res) {
  const token = url.searchParams.get('token') ?? '';
  const order = orders.get(token);
  if (!order) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Unknown order');
  }
  order.status = FLOW_STATUS_PAID;

  // Server-to-server confirmation: only the token, no signature (as the real
  // Flow does, see backend ConfirmPaymentDto). The backend must answer 200
  // after re-querying getStatus itself.
  try {
    const confirmation = await fetch(order.urlConfirmation, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
    order.confirmation = { status: confirmation.status };
  } catch (err) {
    order.confirmation = { status: 0, error: String(err) };
  }

  // Browser return: a POST with the token, which the backend turns into a 302
  // to the frontend's /pago-recibido page.
  sendHtml(
    res,
    `<!doctype html><html lang="es"><meta charset="utf-8"><title>Flow (simulado)</title>` +
      `<body><form id="return" method="POST" action="${escapeHtml(order.urlReturn)}">` +
      `<input type="hidden" name="token" value="${escapeHtml(token)}"></form>` +
      `<script>document.getElementById('return').submit()</script></body></html>`,
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', PUBLIC_URL);
  try {
    if (req.method === 'POST' && url.pathname === '/payment/create') {
      return await createOrder(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/payment/getStatus') {
      return getStatus(url, res);
    }
    if (req.method === 'GET' && url.pathname === '/pay') {
      return payPage(url, res);
    }
    if (req.method === 'POST' && url.pathname === '/pay') {
      return await pay(url, res);
    }
    if (req.method === 'GET' && url.pathname === '/__orders') {
      return sendJson(res, 200, [...orders.values()]);
    }
    if (req.method === 'GET' && url.pathname === '/__health') {
      return sendJson(res, 200, { ok: true });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('fake-flow-server error:', err);
    if (!res.headersSent) sendJson(res, 500, { message: 'fake flow error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Fake Flow listening on ${PUBLIC_URL}`);
});
