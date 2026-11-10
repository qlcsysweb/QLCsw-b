import QRCode from 'qrcode';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { mpRequest } from './mercadopago.client.js';
import { chargeCurrency, convertForCharge, isTestToken, mercadoPagoToken, mpTesting, payerEmailFor, paymentSettings } from './paymentSettings.service.js';
import { paypalRequest } from './paypalSettings.service.js';
import { manualReady, publicStpInfo, stpQuote } from './stpSettings.service.js';
import { bitgetQuote, bitgetSettings, publicWallet } from './bitgetSettings.service.js';

const mockProvider = {
  code: 'MOCK',
  supportsManualResolution: true,
  async quote() {
    return null;
  },
  async createCheckout() {
    return { mode: 'SIMULATED' };
  },
};

const MP_STATUS = { approved: 'APPROVED', rejected: 'REJECTED', cancelled: 'REJECTED', refunded: 'REJECTED', charged_back: 'REJECTED' };
const REVERSED = ['refunded', 'charged_back'];
const isHttps = (url) => String(url).startsWith('https://');

const paymentResult = (payment) => ({
  attemptId: payment.external_reference,
  paymentId: String(payment.id),
  rawStatus: payment.status,
  statusDetail: payment.status_detail || null,
  reversed: REVERSED.includes(payment.status),
  status: MP_STATUS[payment.status] || 'PENDING',
  amount: payment.transaction_amount ?? null,
  currency: payment.currency_id || null,
});

const mercadoPagoProvider = {
  code: 'MERCADOPAGO',
  supportsManualResolution: false,
  async quote(amount, currency) {
    if (amount === null || amount === undefined) throw new HttpError(409, 'Este acceso todavía no tiene precio definido');
    return convertForCharge(amount, currency, await paymentSettings());
  },
  async createCheckout({ attempt, offer, user }) {
    const returnUrl = `${env.frontendUrl}/app/acceso?pago=${attempt.id}`;
    const webhook = isHttps(env.backendUrl) ? { notification_url: `${env.backendUrl}/api/webhooks/mercadopago` } : {};
    if (attempt.billingCycle) {
      const data = await mpRequest('/preapproval', {
        method: 'POST',
        idempotencyKey: attempt.id,
        body: {
          reason: String(offer.name).slice(0, 250),
          external_reference: attempt.id,
          payer_email: await payerEmailFor(user),
          auto_recurring: {
            frequency: attempt.billingCycle === 'YEARLY' ? 12 : 1,
            frequency_type: 'months',
            transaction_amount: Number(attempt.chargedAmount),
            currency_id: attempt.chargedCurrency,
          },
          back_url: returnUrl,
          status: 'pending',
        },
      });
      if (!data.init_point) throw new HttpError(502, 'Mercado Pago no entregó el enlace para contratar la suscripción');
      return { mode: 'REDIRECT', initPoint: data.init_point, subscription: { id: String(data.id), status: data.status, nextBillingAt: data.next_payment_date || null } };
    }
    const includePayer = !(await mpTesting()) || !!(await paymentSettings()).testPayerEmail;
    const data = await mpRequest('/checkout/preferences', {
      method: 'POST',
      idempotencyKey: attempt.id,
      body: {
        items: [{ id: offer.code, title: String(offer.name).slice(0, 250), quantity: 1, unit_price: Number(attempt.chargedAmount), currency_id: attempt.chargedCurrency }],
        ...(includePayer ? { payer: { email: await payerEmailFor(user) } } : {}),
        external_reference: attempt.id,
        back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        ...(isHttps(returnUrl) ? { auto_return: 'approved' } : {}),
        statement_descriptor: 'QLC',
        ...webhook,
      },
    });
    const link = isTestToken(await mercadoPagoToken()) && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
    if (!link) throw new HttpError(502, 'Mercado Pago no entregó el enlace de pago');
    return { mode: 'REDIRECT', initPoint: link, providerRef: String(data.id) };
  },
  async getSubscription(id) {
    return mpRequest(`/preapproval/${encodeURIComponent(id)}`);
  },
  async cancelSubscription(id) {
    await mpRequest(`/preapproval/${encodeURIComponent(id)}`, { method: 'PUT', body: { status: 'canceled' } });
  },
  async fetchPaymentResult(paymentId, fetcher = mpRequest) {
    return paymentResult(await fetcher(`/v1/payments/${encodeURIComponent(paymentId)}`));
  },
  async searchByAttempt(attemptId, fetcher = mpRequest) {
    const data = await fetcher(`/v1/payments/search?external_reference=${encodeURIComponent(attemptId)}&sort=date_created&criteria=desc`);
    return (data.results || []).map(paymentResult);
  },
};

// Pago en efectivo en OXXO (solo México) con la misma cuenta de Mercado Pago. Se guarda como
// intento de MERCADOPAGO para que el webhook y la conciliación existentes activen el acceso al pagarse.
const OXXO_CURRENCY = 'MXN';
const oxxoProvider = {
  code: 'OXXO',
  storedAs: 'MERCADOPAGO',
  oneTime: true,
  supportsManualResolution: false,
  async quote(amount, currency) {
    const charge = await mercadoPagoProvider.quote(amount, currency);
    if (charge.currency !== OXXO_CURRENCY) throw new HttpError(409, 'El pago en OXXO solo está disponible en pesos mexicanos');
    return charge;
  },
  async createCheckout({ attempt, offer, user }) {
    const webhook = isHttps(env.backendUrl) ? { notification_url: `${env.backendUrl}/api/webhooks/mercadopago` } : {};
    const data = await mpRequest('/v1/payments', {
      method: 'POST',
      idempotencyKey: `oxxo-${attempt.id}`,
      body: {
        transaction_amount: Number(attempt.chargedAmount),
        description: String(offer.name).slice(0, 250),
        payment_method_id: 'oxxo',
        payer: { email: await payerEmailFor(user) },
        external_reference: attempt.id,
        ...webhook,
      },
    });
    const ticketUrl = data.transaction_details?.external_resource_url || null;
    const reference = data.transaction_details?.payment_method_reference_id || data.barcode?.content || null;
    if (!ticketUrl && !reference) throw new HttpError(502, 'Mercado Pago no entregó la ficha de pago para OXXO');
    return {
      mode: 'OXXO',
      providerRef: `oxxo:${data.id}`,
      oxxo: {
        reference,
        ticketUrl,
        qr: ticketUrl ? await QRCode.toDataURL(ticketUrl, { margin: 1, width: 240 }) : null,
        expiresAt: data.date_of_expiration || null,
        amount: Number(attempt.chargedAmount),
        currency: attempt.chargedCurrency,
      },
    };
  },
};

const paypalProvider = {
  code: 'PAYPAL',
  supportsManualResolution: false,
  getSubscription: (id) => paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}`),
  async subscriptionSales(id, since) {
    const start = new Date(new Date(since).getTime() - 86400000).toISOString();
    const end = new Date(Date.now() + 3600000).toISOString();
    const data = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`);
    return (data.transactions || []).filter((t) => t.status === 'COMPLETED').map((t) => ({ paymentId: String(t.id), amount: t.amount_with_breakdown?.gross_amount?.value ?? null, currency: t.amount_with_breakdown?.gross_amount?.currency_code ?? null }));
  },
  async cancelSubscription(id) {
    await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason: 'Cancelada por el cliente' } });
  },
};

const bitgetProvider = {
  code: 'BITGET',
  supportsManualResolution: false,
  quote: (amount, currency) => bitgetQuote(amount, currency),
  async createCheckout() {
    const settings = await bitgetSettings();
    return { mode: 'BITGET', uid: settings.uid, instructions: settings.instructions || null, wallet: await publicWallet() };
  },
};

// Transferencia interbancaria a la CLABE de STP (solo México). Manual: se reporta con comprobante
// y el equipo de QLC la aprueba en máximo 24 horas (mismo flujo de revisión que Bitget).
const stpProvider = {
  code: 'STP',
  oneTime: true,
  supportsManualResolution: false,
  quote: (amount, currency) => stpQuote(amount, currency),
  async createCheckout({ user }) {
    return { mode: 'STP', stp: await publicStpInfo(user) };
  },
};

// Depósito en efectivo en OXXO a un número fijo (solo México). Igual que STP: comprobante y aprobación manual.
const oxxoDepositProvider = {
  code: 'OXXO_DEPOSITO',
  oneTime: true,
  supportsManualResolution: false,
  quote: (amount, currency) => stpQuote(amount, currency),
  async createCheckout({ user }) {
    return { mode: 'OXXO_DEPOSITO', stp: await publicStpInfo(user) };
  },
};

export const MERCADOPAGO_COUNTRY = 'MX';

export async function anyGatewayEnabled() {
  const [mp, bitget, manual] = await Promise.all([paymentSettings(), bitgetSettings(), manualReady()]);
  return !!(mp.enabled || bitget.enabled || manual.stp || manual.oxxo);
}

export async function activeProviders(user) {
  const [mp, bitget, manual] = await Promise.all([paymentSettings(), bitgetSettings(), manualReady()]);
  const inMexico = user?.residenceCountry === MERCADOPAGO_COUNTRY;
  const mexico = mp.enabled && inMexico;
  // Orden en que el cliente ve las opciones: Cripto, OXXO, transferencia STP y tarjeta.
  // OXXO es el depósito manual al número de QLC; si no está listo, se usa la ficha de Mercado Pago.
  const oxxo = inMexico && manual.oxxo ? oxxoDepositProvider : mexico && chargeCurrency(mp) === OXXO_CURRENCY ? oxxoProvider : null;
  return [
    ...(bitget.enabled ? [bitgetProvider] : []),
    ...(oxxo ? [oxxo] : []),
    ...(inMexico && manual.stp ? [stpProvider] : []),
    ...(mexico ? [mercadoPagoProvider] : []),
  ];
}

export async function activeProvider(code, user) {
  const list = await activeProviders(user);
  if (code) {
    const found = list.find((p) => p.code === code);
    if (!found) throw new HttpError(409, 'Esta forma de pago no está disponible');
    return found;
  }
  if (list.length) return list.find((p) => p.code === 'MERCADOPAGO') || list[0];
  if (await anyGatewayEnabled()) throw new HttpError(409, 'Por ahora no hay una forma de pago disponible para tu país. Escríbenos para ayudarte.');
  return mockProvider;
}

const ALL = [mockProvider, mercadoPagoProvider, oxxoProvider, paypalProvider, bitgetProvider, stpProvider, oxxoDepositProvider];
export const providerByCode = (code) => ALL.find((p) => p.code === code);
export { bitgetProvider, mercadoPagoProvider, oxxoDepositProvider, oxxoProvider, paypalProvider, stpProvider };
