import { prisma } from '../../config/prisma.js';
import { badRequest, conflict } from '../../utils/httpError.js';
import { driveConnected } from '../google/drive.js';
import { chargeCurrency, convertTo, paymentSettings } from './paymentSettings.service.js';

// Transferencia interbancaria (SPEI) a una CLABE de STP. Es manual: el cliente ve los datos,
// transfiere, sube su comprobante y el equipo de QLC aprueba el pago en máximo 24 horas.
const KEY = 'stp';
export const STP_CURRENCY = 'MXN';
export const STP_REVIEW_HOURS = 24;
const CLABE = /^\d{18}$/;
const DEFAULTS = { enabled: false, clabe: '728969000018696764', bank: 'STP', beneficiary: '', instructions: '' };
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

async function missingRequirements(settings, currencies) {
  const missing = [];
  if (!CLABE.test(settings.clabe || '')) missing.push('la CLABE de 18 dígitos');
  if (!String(settings.beneficiary || '').trim()) missing.push('el nombre del beneficiario');
  if (!(await driveConnected())) missing.push('conectar Google Drive en Integraciones para guardar los comprobantes');
  const rates = await mxnRates();
  for (const c of currencies) if (c !== STP_CURRENCY && !(Number(rates[c]) > 0)) missing.push(`el tipo de cambio de ${c} a MXN (se toma de la configuración de Mercado Pago México)`);
  return missing;
}

export async function stpSettingsView() {
  const settings = await stpSettings();
  return {
    enabled: !!settings.enabled,
    clabe: settings.clabe || '',
    bank: settings.bank || '',
    beneficiary: settings.beneficiary || '',
    instructions: settings.instructions || '',
    currency: STP_CURRENCY,
    reviewHours: STP_REVIEW_HOURS,
    missing: await missingRequirements(settings, await offerCurrencies()),
  };
}

export async function saveStpSettings({ clabe, bank, beneficiary, instructions, enabled }) {
  const changes = {};
  if (clabe !== undefined) {
    const value = String(clabe || '').replace(/\s/g, '');
    if (value && !CLABE.test(value)) throw badRequest('La CLABE debe tener exactamente 18 dígitos.');
    changes.clabe = value;
  }
  if (bank !== undefined) changes.bank = String(bank || '').trim().slice(0, 80);
  if (beneficiary !== undefined) changes.beneficiary = String(beneficiary || '').trim().slice(0, 120);
  if (instructions !== undefined) changes.instructions = String(instructions || '').slice(0, 1000);
  const next = await write(changes);
  if (enabled === true) {
    const missing = await missingRequirements(next, await offerCurrencies());
    if (missing.length) throw badRequest(`Para activar la transferencia STP falta: ${missing.join(', ')}.`);
  }
  if (enabled !== undefined) await write({ enabled: !!enabled });
  if (!CLABE.test(next.clabe || '')) await write({ enabled: false });
  return stpSettingsView();
}

export async function stpQuote(amount, currency) {
  const settings = await stpSettings();
  if (!settings.enabled) throw conflict('Esta forma de pago no está disponible');
  return convertTo(amount, currency, STP_CURRENCY, await mxnRates());
}

export async function publicStpInfo() {
  const settings = await stpSettings();
  if (!settings.enabled) return null;
  return {
    clabe: settings.clabe,
    bank: settings.bank || 'STP',
    beneficiary: settings.beneficiary || '',
    instructions: settings.instructions || '',
    currency: STP_CURRENCY,
    reviewHours: STP_REVIEW_HOURS,
    rates: await mxnRates(),
    whole: false,
  };
}
