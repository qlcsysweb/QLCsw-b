import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { badRequest } from '../utils/httpError.js';

const KEY = 'copytrading-notice';
// Video del Trading Bot que se muestra antes del aviso al iniciar sesión (enlaces de YouTube por idioma).
const VIDEO_KEY = 'login-video';
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

// Acepta los enlaces habituales de YouTube (watch?v=, youtu.be/, shorts/, embed/, live/) y devuelve el ID del video.
export function youtubeId(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (YOUTUBE_ID.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      id = url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] || null;
    }
    return id && YOUTUBE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function loginVideo() {
  const row = await prisma.appSetting.findUnique({ where: { key: VIDEO_KEY } }).catch(() => null);
  const value = row?.value || {};
  return { videoEsUrl: value.es || '', videoEnUrl: value.en || '', video: { es: youtubeId(value.es), en: youtubeId(value.en) } };
}
const CACHE_MS = 12 * 60 * 60 * 1000;

export const NOTICE_DEFAULTS = {
  active: true,
  metrics: { returnPct: 17, days: 180, wins: 50, losses: 0, hitRate: 100, drawdown: 17 },
  bitgetUrl: null,
  infoUrl: env.secondaryPlatformUrl,
  updatedAt: null,
};

let cache = null;

const fromRow = (row) => ({
  active: row.active,
  metrics: { ...NOTICE_DEFAULTS.metrics, ...(row.items || {}) },
  bitgetUrl: row.primaryCtaTarget || null,
  infoUrl: row.secondaryCtaTarget || null,
  updatedAt: row.updatedAt,
});

export async function getLoginNotice() {
  if (cache && cache.exp > Date.now()) return cache.value;
  const row = await prisma.publicSection.findUnique({ where: { key: KEY } });
  const value = { ...(row ? fromRow(row) : NOTICE_DEFAULTS), ...(await loginVideo()) };
  cache = { value, exp: Date.now() + CACHE_MS };
  return value;
}

export async function saveLoginNotice(adminId, { active, metrics, bitgetUrl, infoUrl, videoEsUrl, videoEnUrl }) {
  if (videoEsUrl !== undefined || videoEnUrl !== undefined) {
    const current = await loginVideo();
    const next = { es: videoEsUrl ?? current.videoEsUrl, en: videoEnUrl ?? current.videoEnUrl };
    for (const [lang, link] of Object.entries(next)) {
      if (link && !youtubeId(link)) throw badRequest(`El enlace del video en ${lang === 'es' ? 'español' : 'inglés'} no es un video de YouTube válido.`);
    }
    await prisma.appSetting.upsert({ where: { key: VIDEO_KEY }, create: { key: VIDEO_KEY, value: next }, update: { value: next } });
  }
  const data = { active, items: metrics, primaryCtaTarget: bitgetUrl, secondaryCtaTarget: infoUrl, updatedById: adminId };
  const row = await prisma.publicSection.upsert({
    where: { key: KEY },
    create: { key: KEY, navLabel: 'Aviso de inicio de sesión', position: 0, title: 'QLC Copytrading', ...data },
    update: data,
  });
  cache = null;
  return { ...fromRow(row), ...(await loginVideo()) };
}
