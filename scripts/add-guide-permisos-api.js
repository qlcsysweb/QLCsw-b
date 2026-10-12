/*
 * "Guía de Uso — Permisos de API" (contenido del documento
 * Aviso_Permisos_API_QLC_actualizado.docx entregado por QLC), ubicada justo
 * debajo de "Guía de Uso — Cliente" y encima de "Depósito en Garantía".
 * El backend ya la crea solo al arrancar (src/server.js → ensureSystemGuides);
 * este script permite hacerlo a mano. Idempotente: si ya existe, no hace nada.
 *   node scripts/add-guide-permisos-api.js
 */
require('dotenv').config();
const prisma = require('../src/config/prisma');
const { ensureSystemGuides } = require('../src/utils/systemGuides');

ensureSystemGuides()
  .then((rows) => {
    if (rows.length === 0) console.log('La guía ya existe; no se hizo ningún cambio.');
    rows.forEach((g) => console.log(`Guía creada (id ${g.id}) en la posición ${g.displayOrder}.`));
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
