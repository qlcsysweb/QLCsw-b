/*
 * CORRECCIÓN 4 — Invitación para Capital Temporal para Rescate: estado
 * visible único derivado de la ÚLTIMA invitación del cliente (y, si aplica,
 * de su participación/distribución). Nunca se guarda como columna
 * redundante — se calcula siempre a partir de
 * CapitalRescueInvitation.status y CapitalRescueParticipation.status.
 *
 * Estados posibles:
 *   BLOQUEADO                  — sin invitación activa.
 *   DESBLOQUEADO                — invitación vigente esperando respuesta.
 *   EN_PROCESO                  — cliente confirmó participación; QLC
 *                                todavía no publica instrucciones de depósito.
 *   PENDIENTE_DE_DEPOSITO       — instrucciones de depósito publicadas.
 *   EN_UTILIZACION              — depósito confirmado por QLC.
 *   DISPONIBLE_PARA_DEVOLUCION  — QLC finalizó el rescate.
 *   FINALIZADA                  — remuneración registrada, ciclo cerrado.
 */

function computeRescueState(latestInvitation) {
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
  const participation = latestInvitation.participation;
  if (!participation) return { state: 'BLOQUEADO', invitation: latestInvitation };

  return { state: participation.status, invitation: latestInvitation, participation };
}

function canCreateNewInvitation(computedState) {
  return computedState.state === 'BLOQUEADO' || computedState.state === 'FINALIZADA';
}

const CAPITAL_RESCUE_INCLUDE = {
  apiSubaccount: true,
  participation: {
    include: {
      distribution: {
        include: { items: { include: { apiSubaccount: true }, orderBy: { order: 'asc' } } },
      },
    },
  },
};

module.exports = { computeRescueState, canCreateNewInvitation, CAPITAL_RESCUE_INCLUDE };
