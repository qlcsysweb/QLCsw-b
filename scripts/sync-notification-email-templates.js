/*
 * Copia al backend las plantillas EN de notificaciones que ya usa el portal
 * (frontend/src/i18n/translations.js → en.notificationTemplates) y las
 * etiquetas de estado que interpolan (notificationMessages.js →
 * STATUS_LABEL_KEYS), para que el correo en inglés diga exactamente lo mismo
 * que el panel. El frontend es la fuente única: después de editar esas
 * plantillas, volver a ejecutar:
 *   node scripts/sync-notification-email-templates.js
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FRONT = path.join(__dirname, '..', '..', 'frontend', 'src', 'i18n');
const OUT = path.join(__dirname, '..', 'src', 'i18n', 'notificationEmailTemplates.en.js');

const get = (obj, key) => key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);

(async () => {
  const translations = (await import(pathToFileURL(path.join(FRONT, 'translations.js')).href)).default;
  const { STATUS_LABEL_KEYS } = await import(pathToFileURL(path.join(FRONT, 'notificationMessages.js')).href);
  const en = translations.en;

  const labels = {};
  for (const byParam of Object.values(STATUS_LABEL_KEYS)) {
    for (const byValue of Object.values(byParam)) {
      for (const labelKey of Object.values(byValue)) {
        const text = get(en, labelKey);
        if (typeof text !== 'string') throw new Error(`Falta la etiqueta EN "${labelKey}"`);
        labels[labelKey] = text;
      }
    }
  }

  const data = { templates: en.notificationTemplates, statusLabelKeys: STATUS_LABEL_KEYS, labels };
  const header =
    '// ARCHIVO GENERADO por scripts/sync-notification-email-templates.js — no editar a mano.\n' +
    '// Fuente: frontend/src/i18n/translations.js (en.notificationTemplates) y notificationMessages.js.\n';
  fs.writeFileSync(OUT, `${header}module.exports = ${JSON.stringify(data, null, 2)};\n`);
  console.log(`Plantillas EN: ${Object.keys(data.templates).length} · etiquetas: ${Object.keys(labels).length} → ${path.relative(process.cwd(), OUT)}`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
