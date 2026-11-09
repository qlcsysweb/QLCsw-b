import { PrismaClient } from '@qlc/prisma-education';

const base = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// La base (Neon) se suspende cuando está inactiva y la primera consulta al despertar puede fallar.
// Las lecturas se reintentan unas veces para que el inicio de sesión no falle en ese momento.
const READS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
const TRANSIENT_TEXT = /can't reach database|connection (closed|reset|terminated)|terminating connection|server has closed|timed out fetching a new connection|ECONNRESET|ETIMEDOUT/i;
const RETRY_DELAYS_MS = [300, 1000, 2500];

export const isTransientDbError = (err) => TRANSIENT_CODES.has(err?.code) || TRANSIENT_TEXT.test(String(err?.message || ''));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const prisma = base.$extends({
  query: {
    async $allOperations({ operation, args, query }) {
      if (!READS.has(operation)) return query(args);
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await query(args);
        } catch (err) {
          if (attempt >= RETRY_DELAYS_MS.length || !isTransientDbError(err)) throw err;
          await wait(RETRY_DELAYS_MS[attempt]);
        }
      }
    },
  },
});
