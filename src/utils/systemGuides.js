const prisma = require('../config/prisma');

/*
 * Guías "de sistema": guías normales del módulo Guías de Uso (tabla guides,
 * editables desde ADMIN → Guías de Uso) que además la plataforma necesita
 * poder ubicar por una clave estable — p. ej. la notificación de bienvenida
 * "Permisos de API" abre directamente /client/guides?guide=permisos-api.
 *
 * La clave se resuelve por el título en español con el que se creó la guía
 * (sin columnas nuevas en la base). Si ADMIN cambia ese título, la guía
 * sigue visible y editable; solo la apertura directa vuelve a la primera.
 *
 * Imágenes y PDF viven en el frontend (Vercel) como archivos estáticos:
 * frontend/public/guides/permisos-api/ — mismo origen que el portal.
 */

const API_PERMISSIONS_GUIDE_KEY = 'permisos-api';
const ASSETS = '/guides/permisos-api';

const CONTENT_ES = `<div class="qlc-guide-alert">
  <div class="qlc-guide-alert-kicker">AVISO IMPORTANTE</div>
  <div class="qlc-guide-alert-title">Permisos de API y configuración de IP · QLC</div>
  <p>Para que QLC pueda operar el capital de su cuenta de Bitget mediante el panel, es necesario crear una API Key con los permisos correspondientes al tipo de cuenta. Siga únicamente las indicaciones que correspondan a su configuración.</p>
</div>

<h3>1. Cuenta clásica de Bitget</h3>
<p>Active los permisos que se muestran en el ejemplo:</p>
<figure class="qlc-guide-figure">
  <img src="${ASSETS}/permisos-cuenta-clasica.png" alt="Ejemplo de privilegios de la API en una cuenta clásica de Bitget: Futuros — Órdenes, Futuros — Holdings y Billetera — Transferir" width="749" height="235" loading="lazy" />
  <figcaption>Ejemplo de referencia de una cuenta clásica. Toque la imagen para ampliarla.</figcaption>
</figure>
<ul class="qlc-guide-perms">
  <li><strong>Futuros — Órdenes</strong></li>
  <li><strong>Futuros — Holdings</strong></li>
  <li><strong>Billetera — Transferir</strong></li>
</ul>
<div class="qlc-guide-notice"><strong>Aclaración:</strong> “Billetera – Transferir” se refiere a transferencias internas entre subcuentas propias del titular, no es un permiso para retirar fondos a una cuenta bancaria o dirección externa.</div>

<h3>2. Cuenta UTA (Cuenta Unificada)</h3>
<p>Si utiliza UTA, active los permisos que aparecen en este ejemplo:</p>
<figure class="qlc-guide-figure">
  <img src="${ASSETS}/permisos-cuenta-uta.png" alt="Ejemplo de privilegios de la API en una cuenta UTA (Cuenta Unificada) de Bitget: Cuenta unificada — Gestionar y Cuenta unificada — Tradea" width="746" height="226" loading="lazy" />
  <figcaption>Ejemplo de referencia de una cuenta UTA. Toque la imagen para ampliarla.</figcaption>
</figure>
<ul class="qlc-guide-perms">
  <li><strong>Cuenta unificada — Gestionar</strong></li>
  <li><strong>Cuenta unificada — Tradea</strong></li>
</ul>
<p>Los permisos de la cuenta clásica y los de la cuenta UTA son distintos: active únicamente los que correspondan al tipo de cuenta que utiliza.</p>

<h3>3. ¿Cuándo debo agregar una IP en el panel QLC?</h3>
<p>Si QLC necesita que registre una dirección IP en la API de su cuenta principal, se lo indicará en esta sección del panel. También podrá avisarle por correo electrónico o mediante las notificaciones internas.</p>
<figure class="qlc-guide-figure">
  <img src="${ASSETS}/ip-requerida.png" alt="Sección IP REQUERIDA del panel QLC con el valor NO" width="717" height="316" loading="lazy" />
  <figcaption>Sección “IP REQUERIDA” en el registro de su conexión API dentro del panel QLC.</figcaption>
</figure>
<div class="qlc-guide-ip-grid">
  <div class="qlc-guide-ip-case">
    <div class="qlc-guide-ip-label">IP REQUERIDA: NO</div>
    <p>No necesita agregar ninguna IP por el momento.</p>
  </div>
  <div class="qlc-guide-ip-case is-ip">
    <div class="qlc-guide-ip-label">Aparece una dirección IP</div>
    <p>Agregue exactamente la IP indicada por QLC, cuando se le solicite.</p>
  </div>
</div>
<p>Si no aparece una IP en esta sección, significa que QLC no necesita que la agregue en ese momento. Si llega a ser necesaria más adelante, QLC se lo notificará. <strong>No agregue una IP por su cuenta.</strong></p>

<h3>4. Seguridad</h3>
<div class="qlc-guide-notice"><strong>Seguridad:</strong> comparta las credenciales API únicamente mediante el procedimiento seguro indicado por QLC. Nunca comparta su contraseña de Bitget ni sus códigos de verificación.</div>
<p class="qlc-guide-footnote">QLC · Aviso para clientes</p>`;

const CONTENT_EN = `<div class="qlc-guide-alert">
  <div class="qlc-guide-alert-kicker">IMPORTANT NOTICE</div>
  <div class="qlc-guide-alert-title">API permissions and IP configuration · QLC</div>
  <p>For QLC to operate the capital in your Bitget account through the panel, you need to create an API Key with the permissions that correspond to your account type. Follow only the instructions that apply to your configuration.</p>
</div>

<h3>1. Bitget classic account</h3>
<p>Enable the permissions shown in the example:</p>
<figure class="qlc-guide-figure">
  <img src="${ASSETS}/permisos-cuenta-clasica.png" alt="Example of API privileges on a Bitget classic account: Futures — Orders, Futures — Holdings and Wallet — Transfer" width="749" height="235" loading="lazy" />
  <figcaption>Reference example of a classic account (Bitget interface in Spanish). Tap the image to enlarge it.</figcaption>
</figure>
<ul class="qlc-guide-perms">
  <li><strong>Futures — Orders</strong> <span>(Futuros — Órdenes)</span></li>
  <li><strong>Futures — Holdings</strong> <span>(Futuros — Holdings)</span></li>
  <li><strong>Wallet — Transfer</strong> <span>(Billetera — Transferir)</span></li>
</ul>
<div class="qlc-guide-notice"><strong>Clarification:</strong> “Wallet – Transfer” refers to internal transfers between the account holder's own subaccounts; it is not a permission to withdraw funds to a bank account or an external address.</div>

<h3>2. UTA account (Unified Trading Account)</h3>
<p>If you use UTA, enable the permissions shown in this example:</p>
<figure class="qlc-guide-figure">
  <img src="${ASSETS}/permisos-cuenta-uta.png" alt="Example of API privileges on a Bitget UTA (Unified Trading Account): Unified account — Manage and Unified account — Trade" width="746" height="226" loading="lazy" />
  <figcaption>Reference example of a UTA account (Bitget interface in Spanish). Tap the image to enlarge it.</figcaption>
</figure>
<ul class="qlc-guide-perms">
  <li><strong>Unified account — Manage</strong> <span>(Cuenta unificada — Gestionar)</span></li>
  <li><strong>Unified account — Trade</strong> <span>(Cuenta unificada — Tradea)</span></li>
</ul>
<p>Classic account permissions and UTA permissions are different: enable only the ones that correspond to the account type you use.</p>

<h3>3. When should I add an IP in the QLC panel?</h3>
<p>If QLC needs you to register an IP address in the API of your main account, it will tell you in this section of the panel. QLC may also notify you by email or through internal notifications.</p>
<figure class="qlc-guide-figure">
  <img src="${ASSETS}/ip-requerida.png" alt="IP REQUIRED section of the QLC panel showing NO" width="717" height="316" loading="lazy" />
  <figcaption>“IP REQUIRED” section in your API connection record inside the QLC panel.</figcaption>
</figure>
<div class="qlc-guide-ip-grid">
  <div class="qlc-guide-ip-case">
    <div class="qlc-guide-ip-label">IP REQUIRED: NO</div>
    <p>You do not need to add any IP for now.</p>
  </div>
  <div class="qlc-guide-ip-case is-ip">
    <div class="qlc-guide-ip-label">An IP address appears</div>
    <p>Add exactly the IP indicated by QLC, when you are asked to.</p>
  </div>
</div>
<p>If no IP appears in this section, it means QLC does not need you to add one at this time. If it becomes necessary later, QLC will notify you. <strong>Do not add an IP on your own.</strong></p>

<h3>4. Security</h3>
<div class="qlc-guide-notice"><strong>Security:</strong> share your API credentials only through the secure procedure indicated by QLC. Never share your Bitget password or your verification codes.</div>
<p class="qlc-guide-footnote">QLC · Client notice</p>`;

const API_PERMISSIONS_GUIDE = {
  key: API_PERMISSIONS_GUIDE_KEY,
  titleEs: 'Guía de Uso — Permisos de API',
  titleEn: 'Usage Guide — API Permissions',
  descriptionEs:
    'Qué permisos activar en tu API de Bitget según tu tipo de cuenta (clásica o UTA) y cuándo debes agregar una dirección IP.',
  descriptionEn:
    'Which permissions to enable on your Bitget API depending on your account type (classic or UTA) and when you need to add an IP address.',
  contentEs: CONTENT_ES,
  contentEn: CONTENT_EN,
  // PDF propio de esta guía (archivo estático del frontend). El resto de las
  // guías siguen usando el PDF general configurado en ADMIN (Cloudinary).
  pdfUrl: `${ASSETS}/Guia_Permisos_API_QLC.pdf`,
  // Se ubica justo debajo de esta guía (y encima de "Depósito en Garantía").
  afterTitleEs: 'Guía de Uso — Cliente',
};

const SYSTEM_GUIDES = [API_PERMISSIONS_GUIDE];

// Agrega { key, pdfUrl } a las guías de sistema — el resto pasa sin cambios.
function annotateGuide(guide) {
  const system = SYSTEM_GUIDES.find((s) => s.titleEs === guide.titleEs);
  return system ? { ...guide, key: system.key, pdfUrl: system.pdfUrl } : guide;
}

// Inserta UNA guía de sistema en la posición siguiente a `afterTitleEs`
// (las guías de cliente de ese lugar en adelante bajan uno). Recibe el
// cliente de una transacción para que el corrimiento y la creación sean
// atómicos.
async function insertSystemGuide(tx, guide) {
  const anchor = await tx.guide.findFirst({
    where: { titleEs: guide.afterTitleEs, audience: { in: ['CLIENT', 'BOTH'] } },
    select: { displayOrder: true },
  });
  let position;
  if (anchor) {
    position = anchor.displayOrder + 1;
    await tx.guide.updateMany({
      where: { audience: { in: ['CLIENT', 'BOTH'] }, displayOrder: { gte: position } },
      data: { displayOrder: { increment: 1 } },
    });
  } else {
    const last = await tx.guide.aggregate({ _max: { displayOrder: true } });
    position = (last._max.displayOrder ?? -1) + 1;
  }
  return tx.guide.create({
    data: {
      titleEs: guide.titleEs,
      titleEn: guide.titleEn,
      descriptionEs: guide.descriptionEs,
      descriptionEn: guide.descriptionEn,
      contentEs: guide.contentEs,
      contentEn: guide.contentEn,
      audience: 'CLIENT',
      displayOrder: position,
      isActive: true,
    },
  });
}

/*
 * Crea las guías de sistema que todavía no existen (idempotente: busca por
 * título, también entre las inactivas — si ADMIN la desactivó, no se vuelve
 * a crear ni a activar). Nunca modifica ni borra el contenido de otras guías.
 */
async function ensureSystemGuides(db = prisma) {
  const created = [];
  for (const guide of SYSTEM_GUIDES) {
    const existing = await db.guide.findFirst({ where: { titleEs: guide.titleEs }, select: { id: true } });
    if (existing) continue;
    created.push(await db.$transaction((tx) => insertSystemGuide(tx, guide)));
  }
  return created;
}

module.exports = {
  API_PERMISSIONS_GUIDE,
  API_PERMISSIONS_GUIDE_KEY,
  SYSTEM_GUIDES,
  annotateGuide,
  insertSystemGuide,
  ensureSystemGuides,
};
