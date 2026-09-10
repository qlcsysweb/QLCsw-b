/*
 * Seed inicial de Guías de Uso (CORRECCIÓN 1/6/20/21) — contenido HTML
 * estructurado construido a partir de los documentos Word de referencia
 * (Guia_de_Uso_Cliente_QLC, Especificacion_Flujo_Registro_Subcuentas_QLC,
 * Flujo_Invitaciones_Especiales_QLC, Manual_de_Soporte_QLC_Guia_para_Clientes).
 * Se ejecuta una sola vez; usa upsert por título para no duplicar si se
 * vuelve a correr.
 */
const prisma = require('../src/config/prisma');

const guides = [
  {
    titleEs: 'Guía de Uso — Cliente',
    titleEn: 'Client Usage Guide',
    descriptionEs: 'Su cuenta principal, sus 20 subcuentas, wallet y distribución de saldo.',
    descriptionEn: 'Your main account, your 20 subaccounts, wallet and balance distribution.',
    audience: 'CLIENT',
    displayOrder: 1,
    contentEs: `
      <h3>1. Su cuenta principal y sus 20 subcuentas</h3>
      <p>Al completar su registro, el sistema genera automáticamente:</p>
      <ul>
        <li>1 cuenta principal</li>
        <li>20 subcuentas individuales</li>
      </ul>
      <p>Las 20 subcuentas están vinculadas a su cuenta principal y pertenecen exclusivamente a su perfil. Usted no tendrá que registrarse nuevamente para cada subcuenta.</p>
      <p>Su información general — nombre completo, nacionalidad, información de registro, contrato y documentación correspondiente — queda asociada automáticamente a sus 20 subcuentas.</p>

      <h3>2. Wallet del cliente</h3>
      <p>Desde <strong>Wallet personal</strong> en su panel puede registrar la dirección/enlace de su wallet y la red correspondiente. Esta información le pertenece únicamente a usted, se utiliza posteriormente en la integración de su contrato y QLC nunca ejecuta transferencias automáticas.</p>

      <h3>3. Configuración de API por subcuenta</h3>
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
      <p>No es necesario volver a proporcionar sus datos personales o contractuales. Únicamente deberá configurar la API correspondiente a cada subcuenta.</p>

      <h3>4. Ingreso y distribución de saldo</h3>
      <p>Cuando disponga de saldo autorizado, podrá ingresarlo respetando esta regla: <strong>desde 20 USDT, siempre en tramos de 20 USDT</strong> (múltiplos de 20).</p>
      <table>
        <thead><tr><th>Permitido</th><th>No permitido</th></tr></thead>
        <tbody>
          <tr><td>20, 40, 60, 80, 100 USDT…</td><td>30, 50, 70, 90 USDT…</td></tr>
        </tbody>
      </table>
      <p>Una vez que tenga saldo disponible, usted decide en qué subcuentas distribuirlo. La distribución se realiza en bloques de 20 USDT por subcuenta, siempre desde su propio panel — QLC nunca distribuye el saldo por usted.</p>
      <table>
        <thead><tr><th>Saldo</th><th>Subcuentas que puede financiar</th></tr></thead>
        <tbody>
          <tr><td>20 USDT</td><td>1</td></tr>
          <tr><td>40 USDT</td><td>2</td></tr>
          <tr><td>100 USDT</td><td>5</td></tr>
          <tr><td>200 USDT</td><td>10</td></tr>
          <tr><td>400 USDT</td><td>20</td></tr>
        </tbody>
      </table>
      <p>Su panel siempre muestra: saldo disponible, subcuentas seleccionadas, monto asignado a cada una, saldo pendiente y total distribuido.</p>

      <h3>Resumen</h3>
      <ol>
        <li>Regístrese una sola vez.</li>
        <li>El sistema genera su cuenta principal y sus 20 subcuentas.</li>
        <li>Configure su wallet personal.</li>
        <li>Configure la API Key individual de cada subcuenta que vaya a usar.</li>
        <li>Cuando reciba saldo autorizado, distribúyalo usted mismo entre las subcuentas que desee, en bloques de 20 USDT.</li>
      </ol>
      <p><em>Importante: la información personal y contractual no se registra nuevamente por subcuenta — solo la API es independiente.</em></p>
    `,
    contentEn: `
      <h3>1. Your main account and your 20 subaccounts</h3>
      <p>When you complete your registration, the system automatically creates 1 main account and 20 individual subaccounts, linked to your profile only. You never register again per subaccount.</p>
      <p>Your general information — full name, nationality, registration data, contract and required documentation — is automatically associated with all 20 subaccounts.</p>
      <h3>2. Client wallet</h3>
      <p>From <strong>Personal wallet</strong> in your panel you can register your wallet address/link and network. This information belongs only to you, is later used for your contract, and QLC never executes automatic transfers.</p>
      <h3>3. API configuration per subaccount</h3>
      <p>Each subaccount works independently and, for security and operational control, requires its own API Key. Configure it from <strong>Subaccounts / API</strong> for each one you use.</p>
      <h3>4. Depositing and distributing balance</h3>
      <p>Whenever you have authorized balance, you may enter it following this rule: <strong>from 20 USDT, always in blocks of 20 USDT</strong> (multiples of 20).</p>
      <p>Once you have available balance, you decide which subaccounts to distribute it to, in 20 USDT blocks, always from your own panel — QLC never distributes it for you. Your panel always shows: available balance, selected subaccounts, amount per subaccount, pending balance and total distributed.</p>
      <h3>Summary</h3>
      <ol>
        <li>Register once.</li>
        <li>The system creates your main account and your 20 subaccounts.</li>
        <li>Set up your personal wallet.</li>
        <li>Configure the individual API Key for each subaccount you use.</li>
        <li>When you receive authorized balance, distribute it yourself among the subaccounts you choose, in 20 USDT blocks.</li>
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
    titleEs: 'Flujo de Invitaciones Especiales',
    titleEn: 'Special Invitations Flow',
    descriptionEs: 'Cómo funciona la invitación para aumento de saldo operativo.',
    descriptionEn: 'How the operating balance increase invitation works.',
    audience: 'CLIENT',
    displayOrder: 3,
    contentEs: `
      <h3>Aumento de saldo operativo</h3>
      <p>Dentro de su panel existe la sección <strong>Aumento de saldo</strong>. Permanece visible en todo momento, pero su estado inicial es <strong>BLOQUEADO</strong> mientras QLC no le emita una invitación.</p>
      <div class="qlc-guide-notice">Las invitaciones son emitidas directamente por QLC y están disponibles únicamente para clientes seleccionados.</div>
      <h4>Cuando QLC emite una invitación</h4>
      <p>Verá su saldo actual, el monto máximo autorizado y la vigencia de la invitación. Puede <strong>ACEPTAR</strong> o <strong>RECHAZAR</strong>.</p>
      <ul>
        <li>Si <strong>rechaza</strong>: la invitación se cierra y la sección vuelve a BLOQUEADO. Podrá recibir futuras invitaciones.</li>
        <li>Si <strong>acepta</strong>: indique el monto que le interesa (desde 20 USDT, en múltiplos de 20) y envíe su solicitud.</li>
      </ul>
      <h4>Solicitud en proceso</h4>
      <p>Su solicitud queda en estado <strong>SOLICITUD EN PROCESO</strong>. QLC dispone de hasta 72 horas para autorizarla.</p>
      <h4>Distribución del saldo</h4>
      <p>Una vez autorizada, usted mismo distribuye el monto entre sus subcuentas/API reales, en bloques de 20 USDT, exactamente igual que en la sección de distribución de saldo. QLC nunca realiza esta distribución por usted.</p>
    `,
    contentEn: `
      <h3>Operating balance increase</h3>
      <p>Your panel has an <strong>Balance increase</strong> section, always visible but <strong>BLOCKED</strong> until QLC issues you an invitation, available only to selected clients.</p>
      <h4>When QLC issues an invitation</h4>
      <p>You'll see your current balance, the maximum authorized amount and the validity period. You may <strong>ACCEPT</strong> or <strong>REJECT</strong>.</p>
      <h4>Request in process</h4>
      <p>Your request moves to <strong>REQUEST IN PROCESS</strong>. QLC has up to 72 hours to authorize it.</p>
      <h4>Distributing the balance</h4>
      <p>Once authorized, you distribute the amount yourself among your real subaccounts/API, in 20 USDT blocks. QLC never does this distribution for you.</p>
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
      <p>Su información del cliente (nombre, nacionalidad, contrato) se registra una sola vez y se asocia automáticamente a las 20 subcuentas. Solo la <strong>API Key</strong> es independiente por subcuenta — nunca se comparte entre ellas.</p>
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
      <p>Your client information (name, nationality, contract) is registered once and automatically associated with all 20 subaccounts. Only the <strong>API Key</strong> is independent per subaccount.</p>
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
      <p>Cada subcuenta/API tiene su propio historial de estados de cuenta, independiente del resto. Entre a <strong>Subcuentas / API → (su subcuenta)</strong> para consultarlos.</p>
      <h4>Estados posibles</h4>
      <ul>
        <li><strong>NO DISPONIBLE</strong>: todavía no se ha generado ningún estado de cuenta para el periodo actual.</li>
        <li><strong>DISPONIBLE</strong>: el estado de cuenta fue generado y no tiene comisión pendiente.</li>
        <li><strong>PENDIENTE DE PAGO</strong>: el estado de cuenta generó una comisión que todavía no ha sido pagada.</li>
        <li><strong>PAGADO</strong>: la comisión correspondiente ya fue reportada y validada.</li>
      </ul>
      <p>Cada estado de cuenta incluye el resumen del periodo, las comisiones correspondientes y las notas del equipo de QLC, y puede descargarse en formato PDF generado electrónicamente.</p>
    `,
    contentEn: `
      <h3>Statements per subaccount/API</h3>
      <p>Each subaccount/API keeps its own independent statement history. Go to <strong>Subaccounts / API → (your subaccount)</strong> to view them.</p>
      <h4>Possible statuses</h4>
      <ul>
        <li><strong>NOT AVAILABLE</strong>: no statement has been generated yet for the current period.</li>
        <li><strong>AVAILABLE</strong>: the statement was generated with no pending commission.</li>
        <li><strong>PENDING PAYMENT</strong>: the statement generated a commission not yet paid.</li>
        <li><strong>PAID</strong>: the corresponding commission was reported and validated.</li>
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
