const EN = require('../i18n/notificationEmailTemplates.en.cjs');
const PT = require('../i18n/notificationEmailTemplates.pt.cjs');

const BY_LANGUAGE = { en: EN, pt: PT };

/*
 * Idioma de los correos — el que el usuario eligió en QLC (User.preferredLanguage,
 * se guarda al registrarse y cada vez que cambia de idioma en su panel).
 * Sin preferencia guardada (cuentas anteriores): español, como hasta ahora.
 *
 * Español: el correo usa el título/mensaje guardados en la notificación, tal
 * cual se generaron (sin cambios respecto al comportamiento anterior).
 * Inglés: se arma con las MISMAS plantillas EN que usa el panel (copiadas de
 * frontend/src/i18n por scripts/sync-notification-email-templates.js). Si no
 * hay plantilla, o el aviso no trae los parámetros que pide, se envía el
 * texto original — nunca una frase incompleta.
 */
const normalizeLanguage = (value) => (value === 'en' || value === 'pt' ? value : 'es');

const hasParam = (params, name) => params?.[name] !== undefined && params?.[name] !== null && params?.[name] !== '';

// Misma regla que frontend/src/i18n/notificationMessages.js.
function interpolate(dict, template, templateKey, params) {
  const labelKeys = dict.statusLabelKeys[templateKey] || {};
  return template
    .replace(/\[\[(\w+):([\s\S]*?)\]\]/g, (_, name, inner) => (hasParam(params, name) ? inner : ''))
    .replace(/\{(\w+)\}/g, (_, name) => {
      const raw = params?.[name];
      if (raw === undefined || raw === null) return '';
      const labelKey = labelKeys[name]?.[raw];
      if (labelKey && dict.labels[labelKey]) return dict.labels[labelKey];
      return String(raw);
    });
}

function renderNotificationText(notification, language) {
  const original = { title: notification.title, message: notification.message };
  const dict = BY_LANGUAGE[normalizeLanguage(language)];
  if (!dict || !notification.templateKey) return original;
  const template = dict.templates[notification.templateKey];
  if (!template?.title || !template?.message) return original;
  const params = notification.templateParams || {};
  if (template.requires && !hasParam(params, template.requires)) return original;
  const title = interpolate(dict, template.title, notification.templateKey, params).trim();
  const message = interpolate(dict, template.message, notification.templateKey, params).trim();
  return title && message ? { title, message } : original;
}

module.exports = { normalizeLanguage, renderNotificationText };
