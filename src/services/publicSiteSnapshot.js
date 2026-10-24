const crypto = require('crypto');
const prisma = require('../config/prisma');
const { uploadBuffer } = require('../config/cloudinary');
const { getEffectiveConfig } = require('./affiliateService');

/*
 * DATOS DEL SITIO PÚBLICO SIN CONSULTAS — la página pública NO llama a este
 * backend ni a NeonDB. Los textos (español/inglés) viven en el código del
 * frontend (src/content/). Lo poco que el ADMIN sí sigue actualizando
 * (cifras y enlace del perfil de Bitget, logos ES/EN, multimedia de secciones
 * y reparto vigente del Affiliate Program) se publica como un archivo JSON
 * estático en Cloudinary, con URL fija:
 *   https://res.cloudinary.com/<cloud>/raw/upload/qlc/public/site-data.json
 * El sitio lo lee directo del CDN de Cloudinary (si falla, usa los valores
 * predefinidos del código).
 *
 * Se vuelve a publicar: al arrancar el backend y tras cualquier cambio
 * guardado por un admin (adminRoutes). Solo se sube si el contenido cambió.
 */
const PUBLIC_ID = 'qlc/public/site-data.json';
const LOGO_LOCATIONS = { logo: 'es', logo_en: 'en' };
const DEBOUNCE_MS = 5000;

const num = (v) => (v === null || v === undefined ? null : Number(v));

async function buildPublicSiteSnapshot(db = prisma, now = new Date()) {
  const [track, media, effective, scheduled] = await Promise.all([
    db.trackRecord.findFirst({ where: { isActive: true }, orderBy: { updatedAt: 'desc' } }),
    db.mediaAsset.findMany({
      where: { isPublished: true },
      orderBy: [{ location: 'asc' }, { order: 'asc' }],
      select: { id: true, type: true, url: true, location: true, order: true, isPrimary: true, title: true },
    }),
    getEffectiveConfig(now, db),
    db.affiliateConfigurationHistory.findMany({ where: { effectiveFrom: { gt: now } }, orderBy: { effectiveFrom: 'asc' } }),
  ]);

  // Logos por idioma: imagen y video principales de cada uno.
  const logos = { es: { image: null, video: null }, en: { image: null, video: null } };
  const sectionMedia = {};
  for (const m of media) {
    const lang = LOGO_LOCATIONS[m.location];
    if (lang) {
      if (m.isPrimary) logos[lang][m.type === 'VIDEO' ? 'video' : 'image'] = { type: m.type, url: m.url };
      continue;
    }
    (sectionMedia[m.location] ||= []).push(m);
  }

  const split = (c) => ({ client: num(c.clientSharePct), qlc: num(c.qlcSharePct), affiliate: num(c.affiliateSharePct) });

  return {
    version: 1,
    trackRecord: track
      ? {
          platformName: track.platformName,
          profileLink: track.profileLink,
          ranking: track.ranking,
          roi30d: num(track.roi30d),
          roiDays: track.roiDays,
          winRate: num(track.winRate),
          maxDrawdown: num(track.maxDrawdown),
        }
      : null,
    logos,
    sectionMedia,
    // Reparto vigente + cambios ya programados: el sitio elige por fecha, sin
    // tener que volver a consultar cuando llega la fecha de vigencia.
    distribution: {
      current: split(effective),
      scheduled: scheduled.map((v) => ({ effectiveFrom: v.effectiveFrom.toISOString(), ...split(v) })),
    },
  };
}

let lastHash = null;
let timer = null;

const isConfigured = () =>
  Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

async function publishPublicSiteSnapshot({ force = false } = {}) {
  if (!isConfigured()) return { published: false, reason: 'Cloudinary no está configurado' };
  const snapshot = await buildPublicSiteSnapshot();
  const body = JSON.stringify(snapshot);
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  if (!force && hash === lastHash) return { published: false, reason: 'sin cambios' };
  const payload = JSON.stringify({ ...snapshot, publishedAt: new Date().toISOString() });
  const result = await uploadBuffer(Buffer.from(payload, 'utf8'), { resourceType: 'raw', publicId: PUBLIC_ID, invalidate: true });
  lastHash = hash;
  return { published: true, url: result.secure_url };
}

// Agrupa varios cambios seguidos de un admin en una sola publicación.
function schedulePublicSiteSnapshot() {
  if (process.env.SKIP_PUBLIC_SITE_SNAPSHOT === 'true') return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    publishPublicSiteSnapshot().catch((err) => console.error('[sitio público] no se pudo publicar site-data.json:', err.message));
  }, DEBOUNCE_MS);
  timer.unref?.();
}

module.exports = { PUBLIC_ID, buildPublicSiteSnapshot, publishPublicSiteSnapshot, schedulePublicSiteSnapshot };
