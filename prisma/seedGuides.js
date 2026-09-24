/*
 * Seed inicial de Guías de Uso (CORRECCIÓN 1/6/20/21) — contenido HTML
 * estructurado construido a partir de los documentos Word de referencia
 * (Guia_de_Uso_Cliente_QLC, Especificacion_Flujo_Registro_Subcuentas_QLC,
 * Manual_de_Soporte_QLC_Guia_para_Clientes).
 * Se ejecuta una sola vez; usa upsert por título para no duplicar si se
 * vuelve a correr.
 */
const prisma = require('../src/config/prisma');

const guides = [
  {
    titleEs: 'Guía de Uso — Cliente',
    titleEn: 'Client Usage Guide',
    descriptionEs: 'Su cuenta principal, sus subcuentas, garantía y estado de cuenta.',
    descriptionEn: 'Your main account, your subaccounts, guarantee and account statement.',
    audience: 'CLIENT',
    displayOrder: 1,
    contentEs: `
      <h3>1. Su cuenta principal y sus 20 subcuentas</h3>
      <p>Al completar su registro — datos personales, aceptación del <strong>Aviso de Privacidad</strong> y de los <strong>Términos y Condiciones del Servicio de Copytrading</strong> (incluida la autorización de conexión API, sin facultad de retiro) — el sistema genera automáticamente:</p>
      <ul>
        <li>1 cuenta principal</li>
        <li>20 subcuentas individuales</li>
      </ul>
      <p>Las 20 subcuentas están vinculadas a su cuenta principal y pertenecen exclusivamente a su perfil. Usted no tendrá que registrarse nuevamente para cada subcuenta.</p>
      <p>Su información general — nombre completo, nacionalidad y documentación correspondiente — queda asociada automáticamente a sus 20 subcuentas.</p>

      <h3>2. Configuración de API por subcuenta y capital operativo</h3>
      <p>Cada subcuenta funciona de manera individual y, por seguridad y control operativo, cada una requiere su propia API Key. Aunque todas las subcuentas pertenecen a su mismo perfil, usted deberá configurar la API correspondiente en cada una desde <strong>Subcuentas / API</strong>.</p>
      <table>
        <thead><tr><th>Subcuenta</th><th>API</th></tr></thead>
        <tbody>
          <tr><td>Subcuenta #1</td><td>API Key #1 (independiente)</td></tr>
          <tr><td>Subcuenta #2</td><td>API Key #2 (independiente)</td></tr>
          <tr><td>...</td><td>...</td></tr>
          <tr><td>Subcuenta #20</td><td>API Key #20 (independiente)</td></tr>
        </tbody>
      </table>
      <p>No es necesario volver a proporcionar sus datos personales. Únicamente deberá configurar la API correspondiente a cada subcuenta.</p>
      <p>Cada subcuenta muestra el <strong>capital operativo requerido</strong> (en USDT) que QLC establece para ella — este valor es fijo y usted no puede modificarlo, solo consultarlo para saber cuánto capital necesita tener disponible.</p>

      <h3>3. Garantía y pago — Transferencia interna Bitget</h3>
      <p>El depósito en garantía se realiza siempre en <strong>USDT</strong> mediante <strong>Transferencia interna Bitget</strong> (sin comisión) al UID de recepción de QLC que verá en <strong>Subcuentas / API → (su subcuenta) → Depósito de tu garantía</strong>. Después de transferir, capture únicamente el <strong>número de orden</strong> y la <strong>fecha y hora</strong> de la transacción; QLC lo revisará y usted verá el cambio de estado sin recargar la página.</p>
      <p>Cuando ya haya distribuido su capital en el exchange, repórtelo desde su subcuenta con "Ya realicé la distribución" para que QLC lo verifique.</p>

      <h3>Resumen</h3>
      <ol>
        <li>Regístrese una sola vez.</li>
        <li>El sistema genera su cuenta principal y sus 20 subcuentas.</li>
        <li>Configure la API Key individual de cada subcuenta que vaya a usar.</li>
        <li>Envíe su garantía por Transferencia interna Bitget y reporte número de orden y fecha/hora.</li>
      </ol>
      <p><em>Importante: la información personal no se registra nuevamente por subcuenta — solo la API es independiente.</em></p>
    `,
    contentEn: `
      <h3>1. Your main account and your 20 subaccounts</h3>
      <p>When you complete your registration — personal data, acceptance of the <strong>Privacy Notice</strong> and the <strong>Copytrading Service Terms and Conditions</strong> (including API connection authorization, with no withdrawal permission) — the system automatically creates 1 main account and 20 individual subaccounts, linked to your profile only. You never register again per subaccount.</p>
      <p>Your general information — full name, nationality and required documentation — is automatically associated with all 20 subaccounts.</p>
      <h3>2. API configuration per subaccount and operating capital</h3>
      <p>Each subaccount works independently and, for security and operational control, requires its own API Key. Configure it from <strong>Subaccounts / API</strong> for each one you use.</p>
      <p>Each subaccount shows the <strong>required operating capital</strong> (in USDT) QLC sets for it — a fixed value you can only view, not edit, so you know how much capital you need available.</p>
      <h3>3. Guarantee and payment — Bitget internal transfer</h3>
      <p>The guarantee deposit is always made in <strong>USDT</strong> via <strong>Bitget internal transfer</strong> (no fee) to QLC's receiving UID shown in <strong>Subaccounts / API → (your subaccount) → Your guarantee deposit</strong>. After transferring, enter only the <strong>order number</strong> and the transaction <strong>date and time</strong>; QLC will review it and you'll see the status change without reloading the page.</p>
      <p>Once you've distributed your capital on the exchange, report it from your subaccount with "I already distributed my capital" so QLC can verify it.</p>
      <h3>Summary</h3>
      <ol>
        <li>Register once.</li>
        <li>The system creates your main account and your 20 subaccounts.</li>
        <li>Configure the individual API Key for each subaccount you use.</li>
        <li>Send your guarantee via Bitget internal transfer and report the order number and date/time.</li>
      </ol>
    `,
  },
  {
    titleEs: 'Guía de Soporte',
    titleEn: 'Support Guide',
    descriptionEs: 'Cómo reportar un problema, seguir su caso y solicitar una cita de soporte.',
    descriptionEn: 'How to report an issue, track your case and request a support appointment.',
    audience: 'CLIENT',
    displayOrder: 2,
    contentEs: `
      <h3>1. ¿Cómo reporto un problema?</h3>
      <p>Ingrese al área de <strong>Soporte</strong> y envíe una nueva solicitud describiendo claramente el problema. Procure incluir una descripción clara, lo ocurrido, y documentación de respaldo cuando sea necesaria.</p>
      <h3>2. Carga de documentación</h3>
      <p>Puede adjuntar capturas de pantalla, estados de cuenta, comprobantes u otra evidencia relacionada con su solicitud.</p>
      <h3>3. Número de Caso</h3>
      <p>Al enviar su solicitud correctamente, el sistema genera automáticamente un <strong>Número de Caso</strong> (ejemplo: QLC-000123) que le permite darle seguimiento.</p>
      <h3>4. Respuesta de QLC</h3>
      <p>QLC cuenta con un máximo de <strong>72 horas</strong> para responder dentro del mismo caso.</p>
      <h3>5. ¿No quedó satisfecho con la respuesta?</h3>
      <p>Puede solicitar una <strong>Cita de Soporte</strong> desde el área <em>Citas</em>. La cita habilita un chat privado de atención personalizada de <strong>15 minutos</strong> con el equipo de QLC.</p>
      <div class="qlc-guide-notice">Todas las citas se gestionan con el horario de Ciudad de México, México (CDMX).</div>
      <h3>Flujo completo</h3>
      <ol>
        <li>Reporte su problema en Soporte.</li>
        <li>Adjunte documentación si es necesaria.</li>
        <li>Reciba su Número de Caso.</li>
        <li>QLC responde en un máximo de 72 horas.</li>
        <li>Si no queda satisfecho, solicite una cita en Citas → Soporte.</li>
        <li>Use el chat privado de 15 minutos de su cita para explicar su situación.</li>
      </ol>
    `,
    contentEn: `
      <h3>1. How do I report a problem?</h3>
      <p>Go to the <strong>Support</strong> area and submit a new request clearly describing the issue, including any supporting documentation.</p>
      <h3>2. Uploading documentation</h3>
      <p>You may attach screenshots, statements, receipts or other evidence related to your request.</p>
      <h3>3. Case Number</h3>
      <p>Once submitted, the system automatically generates a <strong>Case Number</strong> (e.g. QLC-000123) to track your request.</p>
      <h3>4. QLC's response</h3>
      <p>QLC has a maximum of <strong>72 hours</strong> to respond within the same case.</p>
      <h3>5. Not satisfied with the response?</h3>
      <p>You may request a <strong>Support Appointment</strong> from the <em>Appointments</em> area, enabling a 15-minute private chat with the QLC team.</p>
      <div class="qlc-guide-notice">All appointments are managed using Mexico City (CDMX) time.</div>
    `,
  },
  {
    titleEs: 'Guía de Subcuentas',
    titleEn: 'Subaccounts Guide',
    descriptionEs: 'Estructura de cuenta principal + 20 subcuentas y sus API independientes.',
    descriptionEn: 'Main account + 20 subaccounts structure and their independent APIs.',
    audience: 'CLIENT',
    displayOrder: 4,
    contentEs: `
      <h3>Estructura de su cuenta</h3>
      <pre>1 Cliente
└── 1 Cuenta Principal
    ├── Subcuenta #1  → Información del cliente + API Key #1
    ├── Subcuenta #2  → Información del cliente + API Key #2
    ├── ...
    └── Subcuenta #20 → Información del cliente + API Key #20</pre>
      <p>Su información del cliente (nombre, nacionalidad) se registra una sola vez y se asocia automáticamente a las 20 subcuentas. Solo la <strong>API Key</strong> es independiente por subcuenta — nunca se comparte entre ellas.</p>
      <h4>Usuario operativo de subcuenta</h4>
      <p>El administrador de QLC asigna manualmente un identificador operativo a cada subcuenta (ejemplo: <code>PCB-1-A-1</code>). Este identificador NO es su usuario de acceso — usted siempre inicia sesión con su correo y contraseña.</p>
    `,
    contentEn: `
      <h3>Your account structure</h3>
      <pre>1 Client
└── 1 Main Account
    ├── Subaccount #1  → Client info + API Key #1
    ├── Subaccount #2  → Client info + API Key #2
    ├── ...
    └── Subaccount #20 → Client info + API Key #20</pre>
      <p>Your client information (name, nationality) is registered once and automatically associated with all 20 subaccounts. Only the <strong>API Key</strong> is independent per subaccount.</p>
      <h4>Subaccount operator ID</h4>
      <p>QLC's admin manually assigns an operational identifier to each subaccount (e.g. <code>PCB-1-A-1</code>). This is NOT your login username — you always sign in with your email and password.</p>
    `,
  },
  {
    titleEs: 'Guía de Estados de Cuenta',
    titleEn: 'Statements Guide',
    descriptionEs: 'Dónde consultar sus estados de cuenta y qué significa cada estado.',
    descriptionEn: 'Where to check your statements and what each status means.',
    audience: 'CLIENT',
    displayOrder: 5,
    contentEs: `
      <h3>Estados de cuenta por subcuenta/API</h3>
      <p>Su estado de cuenta actual se muestra en el <strong>Dashboard → Estado de cuenta</strong> y dentro de cada <strong>Subcuenta / API</strong>.</p>
      <h4>Estados posibles</h4>
      <ul>
        <li><strong>⚪ NO GENERADO</strong>: todavía no se ha generado un estado de cuenta.</li>
        <li><strong>🟡 PENDIENTE DE PAGO</strong>: QLC generó el estado de cuenta; dispone de 72 horas para pagarlo (el contador se muestra en verde y cambia a rojo cuando quedan 12 horas o menos).</li>
        <li><strong>🟢 PAGADO</strong>: QLC confirmó el pago; el contador desaparece.</li>
        <li><strong>🔴 VENCIDO / SIN PAGAR</strong>: terminaron las 72 horas sin pago confirmado.</li>
      </ul>
      <p>Cada estado de cuenta incluye el resumen del periodo, las comisiones correspondientes y las notas del equipo de QLC, y puede descargarse en formato PDF generado electrónicamente.</p>
    `,
    contentEn: `
      <h3>Statements per subaccount/API</h3>
      <p>Your current statement is shown in <strong>Dashboard → Account statement</strong> and inside each <strong>Subaccount / API</strong>.</p>
      <h4>Possible statuses</h4>
      <ul>
        <li><strong>⚪ NOT GENERATED</strong>: no statement has been generated yet.</li>
        <li><strong>🟡 PENDING PAYMENT</strong>: QLC generated the statement; you have 72 hours to pay it (the countdown is green and turns red when 12 hours or less remain).</li>
        <li><strong>🟢 PAID</strong>: QLC confirmed the payment; the countdown disappears.</li>
        <li><strong>🔴 OVERDUE / UNPAID</strong>: the 72 hours ended without a confirmed payment.</li>
      </ul>
    `,
  },
];

(async () => {
  for (const g of guides) {
    const existing = await prisma.guide.findFirst({ where: { titleEs: g.titleEs } });
    if (existing) {
      await prisma.guide.update({ where: { id: existing.id }, data: g });
      console.log('UPDATED', g.titleEs);
    } else {
      await prisma.guide.create({ data: g });
      console.log('CREATED', g.titleEs);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
