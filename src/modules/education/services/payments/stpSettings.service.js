import { prisma } from '../../config/prisma.js';
import { badRequest, conflict } from '../../utils/httpError.js';
import { driveConnected } from '../google/drive.js';
import { chargeCurrency, convertTo, paymentSettings } from './paymentSettings.service.js';

// Pagos manuales en México (en pesos): transferencia interbancaria (SPEI) a la CLABE de STP y
// depósito en efectivo en OXXO a un número fijo. El cliente ve los datos, paga, sube su
// comprobante y el equipo de QLC aprueba el pago en máximo 24 horas.
const KEY = 'stp';
export const STP_CURRENCY = 'MXN';
export const STP_REVIEW_HOURS = 24;
const CLABE = /^\d{18}$/;
const OXXO_NUMBER = /^\d{12,20}$/;
const DEFAULTS = {
  enabled: true,
  clabe: '728969000018696764',
  bank: 'STP',
  beneficiary: '',
  instructions: '',
  oxxoEnabled: true,
  oxxoNumber: '2242175349081620',
  oxxoInstructions: '',
};
let cache = null;

export async function stpSettings() {
  if (cache) return cache;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cache = { ...DEFAULTS, ...(row?.value || {}) };
  return cache;
}

async function write(changes) {
  const value = { ...(await stpSettings()), ...changes };
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
  return stpSettings();
}

export const resetStpCache = () => {
  cache = null;
};

const offerCurrencies = async () => {
  const rows = await prisma.productOffer.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] });
  return rows.map((r) => String(r.currency).toUpperCase());
};

// El tipo de cambio a pesos es el mismo que ya mantiene la configuración de Mercado Pago (México).
async function mxnRates() {
  const mp = await paymentSettings();
  return chargeCurrency(mp) === STP_CURRENCY ? mp.rates || {} : {};
}

async function sharedMissing() {
  const missing = [];
  if (!(await driveConnected())) missing.push('conectar Google Drive en Integraciones para guardar los comprobantes');
  const rates = await mxnRates();
  for (const c of await offerCurrencies()) if (c !== STP_CURRENCY && !(Number(rates[c]) > 0)) missing.push(`el tipo de cambio de ${c} a MXN (se toma de la configuración de Mercado Pago México)`);
  return missing;
}

const stpMissing = (settings, shared) => [...(CLABE.test(settings.clabe || '') ? [] : ['la CLABE de 18 dígitos']), ...shared];
const oxxoMissing = (settings, shared) => [...(OXXO_NUMBER.test(settings.oxxoNumber || '') ? [] : ['el número para depositar en OXXO']), ...shared];

// Listo para ofrecerse: activado y sin requisitos pendientes.
export async function manualReady() {
  const settings = await stpSettings();
  if (!settings.enabled && !settings.oxxoEnabled) return { stp: false, oxxo: false };
  const shared = await sharedMissing();
  return {
    stp: !!settings.enabled && !stpMissing(settings, shared).length,
    oxxo: !!settings.oxxoEnabled && !oxxoMissing(settings, shared).length,
  };
}

export async function stpSettingsView() {
  const settings = await stpSettings();
  const shared = await sharedMissing();
  return {
    enabled: !!settings.enabled,
    clabe: settings.clabe || '',
    bank: settings.bank || '',
    beneficiary: settings.beneficiary || '',
    instructions: settings.instructions || '',
    oxxoEnabled: !!settings.oxxoEnabled,
    oxxoNumber: settings.oxxoNumber || '',
    oxxoInstructions: settings.oxxoInstructions || '',
    currency: STP_CURRENCY,
    reviewHours: STP_REVIEW_HOURS,
    missing: stpMissing(settings, shared),
    oxxoMissing: oxxoMissing(settings, shared),
  };
}

export async function saveStpSettings({ clabe, bank, beneficiary, instructions, enabled, oxxoNumber, oxxoInstructions, oxxoEnabled }) {
  const changes = {};
  if (clabe !== undefined) {
    const value = String(clabe || '').replace(/\s/g, '');
    if (value && !CLABE.test(value)) throw badRequest('La CLABE debe tener exactamente 18 dígitos.');
    changes.clabe = value;
  }
  if (oxxoNumber !== undefined) {
    const value = String(oxxoNumber || '').replace(/\s/g, '');
    if (value && !OXXO_NUMBER.test(value)) throw badRequest('El número de OXXO debe tener solo dígitos (de 12 a 20).');
    changes.oxxoNumber = value;
  }
  if (bank !== undefined) changes.bank = String(bank || '').trim().slice(0, 80);
  if (beneficiary !== undefined) changes.beneficiary = String(beneficiary || '').trim().slice(0, 120);
  if (instructions !== undefined) changes.instructions = String(instructions || '').slice(0, 1000);
  if (oxxoInstructions !== undefined) changes.oxxoInstructions = String(oxxoInstructions || '').slice(0, 1000);
  const next = await write(changes);
  const shared = await sharedMissing();
  if (enabled === true && stpMissing(next, shared).length) throw badRequest(`Para activar la transferencia STP falta: ${stpMissing(next, shared).join(', ')}.`);
  if (oxxoEnabled === true && oxxoMissing(next, shared).length) throw badRequest(`Para activar el depósito en OXXO falta: ${oxxoMissing(next, shared).join(', ')}.`);
  const toggles = {};
  if (enabled !== undefined) toggles.enabled = !!enabled;
  if (oxxoEnabled !== undefined) toggles.oxxoEnabled = !!oxxoEnabled;
  if (Object.keys(toggles).length) await write(toggles);
  return stpSettingsView();
}

export async function stpQuote(amount, currency) {
  return convertTo(amount, currency, STP_CURRENCY, await mxnRates());
}

// Datos que ve el cliente. El beneficiario es el nombre del propio cliente salvo que el panel defina otro.
export async function publicStpInfo(user) {
  const settings = await stpSettings();
  const ready = await manualReady();
  if (!ready.stp && !ready.oxxo) return null;
  return {
    ...(ready.stp ? { clabe: settings.clabe, bank: settings.bank || 'STP', beneficiary: settings.beneficiary || user?.name || '', instructions: settings.instructions || '' } : {}),
    ...(ready.oxxo ? { oxxoNumber: settings.oxxoNumber, oxxoInstructions: settings.oxxoInstructions || '' } : {}),
    reference: user?.name || null,
    currency: STP_CURRENCY,
    reviewHours: STP_REVIEW_HOURS,
    rates: await mxnRates(),
    whole: false,
  };
}
