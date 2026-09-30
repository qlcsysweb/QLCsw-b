/*
 * Actualización de contenido de las guías de uso (pedido de QLC, 30/09/2026):
 *  - Guía de Uso — Cliente: se elimina "Wallet personal"; "Depósito en
 *    garantía" pasa a "Transferencia interna BITGET"; las cuentas se nombran
 *    PRINCIPAL / Subcuenta #N (el identificador interno no lo ve el cliente);
 *    citas en horario UTC. Versión en inglés reescrita con el mismo contenido.
 *  - Guía de Soporte: citas en horario UTC.
 *  - Flujo de Invitaciones Especiales: texto nuevo entregado por QLC
 *    (invitación por E-mail, bloques de mínimo 100 USDT).
 *
 * Solo actualiza estas 3 guías por su ID (no borra nada). Respaldo previo en
 * .qlc-backups/guides-before-2026-09-30.json. Uso:
 *   node scripts/update-guides-2026-09-30.js
 */
require('dotenv').config();
const prisma = require('../src/config/prisma');

const CLIENT_GUIDE_ID = 'cmtw5mfgg00007kk48hi9i00z';
const SUPPORT_GUIDE_ID = 'cmtw5mfla00017kk4u0cnryeg';
const INVITATIONS_GUIDE_ID = 'cmtw5mfq300027kk4z7rzaf3j';

const CLIENT_ES = `<h2>1. Inicio de sesión</h2>
<p>Ingresa con el correo electrónico y la contraseña registrados en QLC, o con el código de Google Authenticator.</p>
<p>La primera vez que inicies sesión deberás registrar Google Authenticator; es obligatorio y solo se hace una vez. Si tienes problemas para entrar, utiliza la opción <strong>Restablecer contraseña</strong> o comunícate mediante soporte.</p>

<h2>2. Panel principal</h2>
<p>En el panel principal podrás consultar:</p>
<ul>
  <li>Estado general de tu cuenta.</li>
  <li>Progreso del proceso de activación.</li>
  <li>Notificaciones.</li>
  <li>Información de tus cuentas y subcuentas.</li>
  <li>Estados de cuenta.</li>
  <li>Avisos importantes de QLC.</li>
</ul>
<p>El progreso muestra cuántas condiciones del proceso han sido completadas y cuáles todavía están pendientes.</p>

<h2>3. Perfil</h2>
<p>En esta sección puedes consultar tus datos personales registrados, como:</p>
<ul>
  <li>Usuario.</li>
  <li>Nombre completo.</li>
  <li>Correo electrónico.</li>
  <li>Información de tu cuenta.</li>
</ul>
<p>Si necesitas modificar algún dato que no puedas editar directamente, solicita ayuda mediante soporte.</p>

<h2>4. Cuentas y subcuentas API</h2>
<p>Aquí encontrarás tu cuenta principal (PRINCIPAL) y tus subcuentas (Subcuenta #1, Subcuenta #2…). Cada cuenta puede mostrar:</p>
<ul>
  <li>Modelo de participación.</li>
  <li>Capital operativo requerido.</li>
  <li>Estado de conexión.</li>
  <li>IP, cuando sea requerida.</li>
  <li>Progreso de activación.</li>
</ul>
<p>Los datos que el administrador configure como obligatorios aparecerán como información fija y no podrán modificarse libremente.</p>

<h2>5. Credenciales API</h2>
<p>Cuando QLC solicite la conexión mediante API, podrás registrar:</p>
<ul>
  <li>API Key.</li>
  <li>Secret Key.</li>
  <li>Passphrase.</li>
  <li>IP, si el administrador la requiere.</li>
</ul>
<p>Revisa cuidadosamente los datos antes de enviarlos. QLC no utiliza estos datos para retirar fondos de tu cuenta.</p>

<h2>6. Transferencia interna BITGET</h2>
<p>Los pagos a QLC (garantía y estados de cuenta) se realizan mediante <strong>Transferencia interna Bitget</strong>, desde tu propia cuenta de Bitget hacia el UID de recepción de QLC. Bitget no cobra comisión por transferencias internas y no necesitas dirección de wallet ni elegir red. El proceso es:</p>
<ol>
  <li>Copia el <strong>UID de recepción de QLC</strong> que aparece en tu subcuenta (sección Transferencia interna Bitget).</li>
  <li>En tu cuenta de Bitget ve a Activos → Retirar → Transferencia interna e ingresa el UID de QLC.</li>
  <li>Envía el monto indicado en USDT.</li>
  <li>Bitget te dará un <strong>N.º de orden</strong>: regístralo en tu panel junto con la fecha y hora de la transferencia y adjunta la evidencia (captura o PDF).</li>
  <li>Espera la revisión del administrador; verás el estado de tu reporte sin recargar la página.</li>
</ol>
<p>El N.º de orden es distinto del UID de QLC. El reporte del cliente no significa que el pago ya esté aprobado: el administrador debe revisar la información y actualizar el estado. Si tu reporte es rechazado, verás el motivo y podrás corregirlo.</p>

<h2>7. Reporte de distribución de capital</h2>
<p>En esta sección se mostrará el capital operativo requerido para la cuenta o subcuenta, definido por el administrador (mínimo 100 USDT). El cliente no podrá modificar el capital requerido, pero sí podrá confirmar que dispone del saldo escribiendo una de las frases indicadas (en español o en inglés).</p>

<h2>8. Estados de cuenta</h2>
<p>Los estados de cuenta se mostrarán asociados a la cuenta o subcuenta correspondiente. Cada estado podrá mostrar:</p>
<ul>
  <li>Periodo.</li>
  <li>Capital inicial.</li>
  <li>Capital final.</li>
  <li>Rendimiento.</li>
  <li>Resultado neto.</li>
  <li>Comisión QLC.</li>
  <li>Estado del pago.</li>
  <li>Fecha de generación.</li>
  <li>Fecha de vencimiento.</li>
</ul>
<p>Cuando se genere un estado de cuenta, aparecerá como "Generado". Después de que el administrador registre el pago, se mostrará como "Pagado".</p>

<h2>9. Soporte y citas</h2>
<p>Cuando tengas algún problema, primero debes registrar un caso de soporte. El sistema generará un número de caso para dar seguimiento. Desde ese mismo caso podrás:</p>
<ul>
  <li>Consultar las respuestas del administrador.</li>
  <li>Enviar mensajes.</li>
  <li>Solicitar una cita.</li>
  <li>Seleccionar la cuenta o subcuenta que deseas revisar.</li>
  <li>Consultar el estado de la cita.</li>
</ul>
<p>Las citas se muestran en horario <strong>UTC</strong>, en bloques de 15 minutos, y requieren una anticipación mínima de una hora. Cuando la cita sea autorizada y llegue la hora correspondiente, se habilitará el chat de soporte durante 15 minutos, en el que también puedes enviar imágenes o PDF.</p>

<h2>10. Notificaciones</h2>
<p>Las notificaciones te informarán sobre cambios importantes relacionados con tu cuenta. Podrás recibir avisos sobre:</p>
<ul>
  <li>Pagos.</li>
  <li>Estados de cuenta.</li>
  <li>Citas.</li>
  <li>Soporte.</li>
  <li>Cambios en el proceso de activación.</li>
  <li>Conexión o desconexión de API.</li>
</ul>
<p>Revisa esta sección con frecuencia. Puedes eliminar las notificaciones que ya no necesites, una por una o todas a la vez.</p>

<h2>11. Seguridad</h2>
<p>QLC no solicita que entregues tu capital de inversión directamente a la empresa. El capital permanece en la cuenta del cliente en la plataforma externa correspondiente. La conexión API debe utilizar únicamente los permisos autorizados y no debe permitir retiros.</p>
<p>Si recibes una solicitud sospechosa, no realices ninguna transferencia y comunícate mediante los canales oficiales de QLC.</p>`;

const CLIENT_EN = `<h2>1. Signing in</h2>
<p>Sign in with the email and password registered with QLC, or with your Google Authenticator code.</p>
<p>The first time you sign in you must register Google Authenticator; it is mandatory and done only once. If you have trouble signing in, use the <strong>Reset password</strong> option or contact support.</p>

<h2>2. Main panel</h2>
<p>In the main panel you can check:</p>
<ul>
  <li>Your account's overall status.</li>
  <li>Activation process progress.</li>
  <li>Notifications.</li>
  <li>Information about your accounts and subaccounts.</li>
  <li>Statements.</li>
  <li>Important QLC notices.</li>
</ul>
<p>The progress shows how many process conditions are complete and which are still pending.</p>

<h2>3. Profile</h2>
<p>In this section you can check your registered personal data, such as:</p>
<ul>
  <li>Username.</li>
  <li>Full name.</li>
  <li>Email.</li>
  <li>Your account information.</li>
</ul>
<p>If you need to change any data you cannot edit directly, ask for help through support.</p>

<h2>4. API accounts and subaccounts</h2>
<p>Here you will find your main account (PRINCIPAL) and your subaccounts (Subaccount #1, Subaccount #2…). Each account can show:</p>
<ul>
  <li>Participation model.</li>
  <li>Required operating capital.</li>
  <li>Connection status.</li>
  <li>IP, when required.</li>
  <li>Activation progress.</li>
</ul>
<p>Data the administrator sets as mandatory appears as fixed information and cannot be freely changed.</p>

<h2>5. API credentials</h2>
<p>When QLC requests the API connection, you can register:</p>
<ul>
  <li>API Key.</li>
  <li>Secret Key.</li>
  <li>Passphrase.</li>
  <li>IP, if the administrator requires it.</li>
</ul>
<p>Check the data carefully before sending it. QLC does not use this data to withdraw funds from your account.</p>

<h2>6. BITGET internal transfer</h2>
<p>Payments to QLC (guarantee and statements) are made through a <strong>Bitget internal transfer</strong>, from your own Bitget account to QLC's receiving UID. Bitget does not charge a fee for internal transfers and you don't need a wallet address or to choose a network. The process is:</p>
<ol>
  <li>Copy <strong>QLC's receiving UID</strong> shown in your subaccount (Bitget internal transfer section).</li>
  <li>In your Bitget account go to Assets → Withdraw → Internal transfer and enter QLC's UID.</li>
  <li>Send the indicated amount in USDT.</li>
  <li>Bitget will give you an <strong>order number</strong>: register it in your panel together with the transfer date and time, and attach the evidence (screenshot or PDF).</li>
  <li>Wait for the administrator's review; you will see your report's status without reloading the page.</li>
</ol>
<p>The order number is different from QLC's UID. Your report does not mean the payment is already approved: the administrator must review the information and update the status. If your report is rejected, you will see the reason and can correct it.</p>

<h2>7. Capital distribution report</h2>
<p>This section shows the required operating capital for the account or subaccount, set by the administrator (minimum 100 USDT). You cannot change the required capital, but you can confirm that you have the balance by typing one of the phrases shown (in Spanish or English).</p>

<h2>8. Statements</h2>
<p>Statements are shown linked to their account or subaccount. Each statement can show:</p>
<ul>
  <li>Period.</li>
  <li>Initial capital.</li>
  <li>Final capital.</li>
  <li>Return.</li>
  <li>Net result.</li>
  <li>QLC commission.</li>
  <li>Payment status.</li>
  <li>Generation date.</li>
  <li>Due date.</li>
</ul>
<p>When a statement is generated, it appears as "Generated". After the administrator records the payment, it shows as "Paid".</p>

<h2>9. Support and appointments</h2>
<p>When you have an issue, you must first register a support case. The system generates a case number for follow-up. From that same case you can:</p>
<ul>
  <li>Read the administrator's replies.</li>
  <li>Send messages.</li>
  <li>Request an appointment.</li>
  <li>Select the account or subaccount you want reviewed.</li>
  <li>Check the appointment status.</li>
</ul>
<p>Appointments are shown in <strong>UTC</strong> time, in 15-minute slots, and require at least one hour in advance. Once the appointment is authorized and its time arrives, the support chat is enabled for 15 minutes; you can also send images or PDF files in it.</p>

<h2>10. Notifications</h2>
<p>Notifications inform you about important changes to your account. You can receive notices about:</p>
<ul>
  <li>Payments.</li>
  <li>Statements.</li>
  <li>Appointments.</li>
  <li>Support.</li>
  <li>Changes in the activation process.</li>
  <li>API connection or disconnection.</li>
</ul>
<p>Check this section often. You can delete notifications you no longer need, one by one or all at once.</p>

<h2>11. Security</h2>
<p>QLC does not ask you to hand over your investment capital directly to the company. The capital stays in the client's account on the corresponding external platform. The API connection must use only the authorized permissions and must not allow withdrawals.</p>
<p>If you receive a suspicious request, do not make any transfer and contact QLC through its official channels.</p>`;

const INVITATIONS_ES = `<h3>Aumento de saldo operativo</h3>
<p>El aumento de saldo operativo está disponible únicamente mediante <strong>invitación emitida directamente por QLC</strong>.</p>
<p>Las invitaciones son enviadas por <strong>E-mail</strong> exclusivamente a clientes seleccionados por QLC. El cliente no puede solicitar una invitación por cuenta propia.</p>
<div class="qlc-guide-notice">«Las invitaciones son emitidas directamente por QLC y enviadas por E-mail únicamente a clientes seleccionados.»</div>
<h4>Cuando QLC emite una invitación</h4>
<p>Cuando QLC seleccione a un cliente para recibir una invitación, recibirá un E-mail con la información correspondiente, incluyendo su saldo actual, el monto de aumento propuesto por QLC, la distribución autorizada por cuenta y la vigencia de la invitación.</p>
<p>El cliente deberá responder el mismo E-mail para indicar si <strong>ACEPTA</strong> o <strong>RECHAZA</strong> la propuesta.</p>
<ul>
  <li>Si <strong>rechaza</strong>: la invitación se cierra y podrá recibir futuras invitaciones.</li>
  <li>Si <strong>acepta</strong>: deberá responder el E-mail confirmando su aceptación del monto propuesto por QLC y de la distribución indicada.</li>
</ul>
<h4>Solicitud en proceso</h4>
<p>Una vez recibida la respuesta de aceptación, la solicitud queda en estado <strong>SOLICITUD EN PROCESO</strong>. QLC dispone de hasta 72 horas para autorizar y habilitar el monto propuesto.</p>
<h4>Distribución del saldo</h4>
<p>Una vez autorizada la solicitud, el cliente deberá distribuir el saldo entre sus subcuentas/API reales, siguiendo exactamente la distribución indicada por QLC en el E-mail de invitación.</p>
<p>El saldo se distribuirá en bloques de mínimo <strong>100 USDT</strong> por cuenta, de acuerdo con la estructura y cantidades especificadas por QLC.</p>
<p>QLC no realiza directamente la distribución del saldo. El cliente deberá efectuarla siguiendo las instrucciones proporcionadas en su invitación.</p>`;

const INVITATIONS_EN = `<h3>Operating balance increase</h3>
<p>The operating balance increase is available only through an <strong>invitation issued directly by QLC</strong>.</p>
<p>Invitations are sent by <strong>email</strong> exclusively to clients selected by QLC. Clients cannot request an invitation on their own.</p>
<div class="qlc-guide-notice">"Invitations are issued directly by QLC and sent by email only to selected clients."</div>
<h4>When QLC issues an invitation</h4>
<p>When QLC selects a client to receive an invitation, the client will receive an email with the relevant information, including their current balance, the increase amount proposed by QLC, the authorized distribution per account and the invitation's validity period.</p>
<p>The client must reply to that same email to state whether they <strong>ACCEPT</strong> or <strong>REJECT</strong> the proposal.</p>
<ul>
  <li>If they <strong>reject</strong>: the invitation is closed and they may receive future invitations.</li>
  <li>If they <strong>accept</strong>: they must reply to the email confirming their acceptance of the amount proposed by QLC and of the indicated distribution.</li>
</ul>
<h4>Request in process</h4>
<p>Once the acceptance reply is received, the request moves to <strong>REQUEST IN PROCESS</strong>. QLC has up to 72 hours to authorize and enable the proposed amount.</p>
<h4>Distributing the balance</h4>
<p>Once the request is authorized, the client must distribute the balance among their real subaccounts/API, following exactly the distribution indicated by QLC in the invitation email.</p>
<p>The balance is distributed in blocks of at least <strong>100 USDT</strong> per account, according to the structure and amounts specified by QLC.</p>
<p>QLC does not distribute the balance directly. The client must do it following the instructions provided in their invitation.</p>`;

async function main() {
  const support = await prisma.guide.findUnique({ where: { id: SUPPORT_GUIDE_ID } });
  if (!support) throw new Error('No se encontró la Guía de Soporte');
  const supportEs = support.contentEs.replace(
    'Todas las citas se gestionan con el horario de Ciudad de México, México (CDMX).',
    'Todas las citas se gestionan en horario UTC.'
  );
  const supportEn = (support.contentEn || '').replace(
    'All appointments are managed using Mexico City (CDMX) time.',
    'All appointments are managed in UTC time.'
  );

  await prisma.$transaction([
    prisma.guide.update({
      where: { id: CLIENT_GUIDE_ID },
      data: {
        descriptionEs: 'Su cuenta principal, sus subcuentas, la transferencia interna Bitget y la distribución de capital.',
        descriptionEn: 'Your main account, your subaccounts, the Bitget internal transfer and capital distribution.',
        contentEs: CLIENT_ES,
        contentEn: CLIENT_EN,
      },
    }),
    prisma.guide.update({ where: { id: SUPPORT_GUIDE_ID }, data: { contentEs: supportEs, contentEn: supportEn } }),
    prisma.guide.update({
      where: { id: INVITATIONS_GUIDE_ID },
      data: { contentEs: INVITATIONS_ES, contentEn: INVITATIONS_EN },
    }),
  ]);
  console.log('Guías actualizadas: Cliente, Soporte e Invitaciones Especiales.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
