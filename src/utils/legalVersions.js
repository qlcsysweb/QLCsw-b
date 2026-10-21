/*
 * Versión vigente del Aviso de Privacidad y de los Términos y Condiciones —
 * se registra en cada alta para auditar qué versión aceptó el cliente.
 * Los textos viven en el código (frontend/src/content/publicContent.js →
 * sección "legal"), así que la versión también: al cambiar alguno de esos
 * textos, actualiza aquí su fecha/hora (ISO). Ya no se consulta NeonDB.
 * Valores iniciales = fecha de la última edición de cada texto en el CMS.
 */
const LEGAL_VERSIONS = {
  privacy: '2026-10-04T05:09:36.604Z',
  terms: '2026-10-03T13:38:06.783Z',
};

module.exports = { LEGAL_VERSIONS };
