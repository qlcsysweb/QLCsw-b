const { PrismaClient } = require('@qlc/prisma-trading');
const { PrismaNeon } = require('@prisma/adapter-neon');

const useNeonDriver = (process.env.TRAD_DB_DRIVER || 'neon') === 'neon';

const prisma = new PrismaClient({
  ...(useNeonDriver ? { adapter: new PrismaNeon({ connectionString: process.env.TRAD_DATABASE_URL }) } : {}),
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
