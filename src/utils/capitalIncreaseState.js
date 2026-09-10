/*
 * CORRECCIÓN 7 — Invitación para aumento de saldo operativo: estado visible
 * único derivado de la ÚLTIMA invitación del cliente (y, si aplica, de su
 * solicitud/distribución). Nunca se guarda como columna redundante — se
 * calcula siempre a partir de CapitalIncreaseInvitation.status,
 * CapitalIncreaseRequest.status y las fechas de vigencia, igual que el
 * resto de estados derivados de esta plataforma (ver Statement.displayStatus).
 *
 * Estados posibles:
 *   BLOQUEADO            — sin invitación activa (nunca hubo, fue rechazada,
 *                           venció sin respuesta o el ciclo anterior ya se
 *                           completó). El admin puede crear una nueva.
 *   DESBLOQUEADO          — invitación vigente esperando respuesta del cliente.
 *   SOLICITUD_EN_PROCESO  — el cliente aceptó y envió su solicitud; QLC
 *                           todavía no publica la distribución.
 *   INSTRUCCIONES_EMITIDAS — distribución publicada, esperando que el
 *                           cliente la marque como leída.
 *   COMPLETADA            — el cliente ya marcó como leídas las instrucciones.
 */

function computeCapitalState(latestInvitation) {
  if (!latestInvitation) return { state: 'BLOQUEADO', invitation: null };

  if (latestInvitation.status === 'RECHAZADA') {
    return { state: 'BLOQUEADO', invitation: latestInvitation };
  }

  if (latestInvitation.status === 'DESBLOQUEADA') {
    if (new Date(latestInvitation.expiresAt) < new Date()) {
      return { state: 'BLOQUEADO', invitation: latestInvitation, expired: true };
    }
    return { state: 'DESBLOQUEADO', invitation: latestInvitation };
  }

  // ACEPTADA
  const request = latestInvitation.request;
  if (!request) return { state: 'BLOQUEADO', invitation: latestInvitation };

  if (request.status === 'INSTRUCCIONES_EMITIDAS') {
    return { state: 'INSTRUCCIONES_EMITIDAS', invitation: latestInvitation, request };
  }
  if (request.status === 'COMPLETADA') {
    return { state: 'COMPLETADA', invitation: latestInvitation, request };
  }
  // EN_PROCESO o DISTRIBUCION_EN_PROCESO — desde la perspectiva del cliente
  // ambos se ven igual: su solicitud está siendo procesada por QLC.
  return { state: 'SOLICITUD_EN_PROCESO', invitation: latestInvitation, request };
}

// El admin solo puede crear una invitación nueva cuando no hay ninguna
// activa esperando respuesta/procesamiento del ciclo anterior.
function canCreateNewInvitation(computedState) {
  return computedState.state === 'BLOQUEADO' || computedState.state === 'COMPLETADA';
}

const CAPITAL_INCREASE_INCLUDE = {
  request: {
    include: {
      distribution: {
        include: { items: { include: { apiSubaccount: true }, orderBy: { order: 'asc' } } },
      },
    },
  },
};

module.exports = { computeCapitalState, canCreateNewInvitation, CAPITAL_INCREASE_INCLUDE };
