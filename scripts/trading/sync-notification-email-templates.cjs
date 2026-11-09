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

const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'modules', 'trading', 'i18n');
const OUT_DIR = path.join(__dirname, '..', '..', 'src', 'modules', 'trading', 'i18n');

const get = (obj, key) => key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);

(async () => {
  const translations = (await import(pathToFileURL(path.join(FRONT, 'translations.js')).href)).default;
  const pt = (await import(pathToFileURL(path.join(FRONT, 'translations.pt.js')).href)).default;
  const { STATUS_LABEL_KEYS } = await import(pathToFileURL(path.join(FRONT, 'notificationMessages.js')).href);

  // Inglés y portugués; el español usa el texto guardado en cada notificación.
  for (const [code, dict] of [['en', translations.en], ['pt', pt]]) {
    const labels = {};
    for (const byParam of Object.values(STATUS_LABEL_KEYS)) {
      for (const byValue of Object.values(byParam)) {
        for (const labelKey of Object.values(byValue)) {
          const text = get(dict, labelKey);
          if (typeof text !== 'string') throw new Error(`Falta la etiqueta ${code.toUpperCase()} "${labelKey}"`);
          labels[labelKey] = text;
        }
      }
    }
    const data = { templates: dict.notificationTemplates, statusLabelKeys: STATUS_LABEL_KEYS, labels };
    const out = path.join(OUT_DIR, `notificationEmailTemplates.${code}.cjs`);
    const header =
      '// ARCHIVO GENERADO por scripts/sync-notification-email-templates.js — no editar a mano.\n' +
      `// Fuente: frontend/src/modules/trading/i18n (${code}.notificationTemplates) y notificationMessages.js.\n`;
    fs.writeFileSync(out, `${header}module.exports = ${JSON.stringify(data, null, 2)};\n`);
    console.log(`Plantillas ${code.toUpperCase()}: ${Object.keys(data.templates).length} · etiquetas: ${Object.keys(labels).length} → ${path.relative(process.cwd(), out)}`);
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
