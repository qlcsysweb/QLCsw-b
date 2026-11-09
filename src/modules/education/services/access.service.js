import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { applyTrial, summarizeAccess, trialWindow } from '../domain/access.js';

export const loadGrants = (userId, db = prisma) => db.accessGrant.findMany({ where: { userId, active: true } });

export const withTrial = (access, user) => applyTrial(access, trialWindow(user, env.freeTrialDays));

export async function getAccess(userId, db = prisma) {
  const [grants, user] = await Promise.all([
    loadGrants(userId, db),
    env.freeTrialDays ? db.user.findUnique({ where: { id: userId }, select: { role: true, createdAt: true } }) : null,
  ]);
  return withTrial(summarizeAccess(grants), user);
}

export const ADMIN_ACCESS = { full: { active: true, expiresAt: null }, tools: [1, 2, 3, 4, 5, 6], masterclass: { active: true, expiresAt: null, all: true }, masterclassModules: [], hasAny: true, mode: 'FULL' };

export const accessFor = (req) => (req.asAdmin ? ADMIN_ACCESS : getAccess(req.subjectId));

export const publicOffer = (o) => ({
  code: o.code,
  name: o.name,
  description: o.description,
  type: o.type,
  moduleNumber: o.moduleNumber,
  price: o.price === null || o.price === undefined ? null : Number(o.price),
  currency: o.currency,
  accessDays: o.accessDays,
  billingCycle: o.billingCycle || null,
  active: o.active,
  giftable: o.giftable !== false,
  sessions: o.sessions || 0,
});

const OFFERS_TTL_MS = 12 * 60 * 60 * 1000;
let offersCache = { data: null, at: 0 };

export const invalidateOffersCache = () => {
  offersCache = { data: null, at: 0 };
};

export async function cachedActiveOffers() {
  if (offersCache.data && Date.now() - offersCache.at < OFFERS_TTL_MS) return offersCache.data;
  try {
    const data = await listOffers();
    offersCache = { data, at: Date.now() };
    return data;
  } catch (err) {
    if (offersCache.data) return offersCache.data;
    throw err;
  }
}

export const listOffers = async ({ includeInactive = false } = {}) =>
  (await prisma.productOffer.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  })).map(publicOffer);
