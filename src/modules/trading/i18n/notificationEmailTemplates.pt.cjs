// ARCHIVO GENERADO por scripts/sync-notification-email-templates.js — no editar a mano.
// Fuente: frontend/src/modules/trading/i18n (pt.notificationTemplates) y notificationMessages.js.
module.exports = {
  "templates": {
    "appointment_rejected_reschedule": {
      "title": "Não podemos atender você nesse horário",
      "message": "Não podemos atender você em {date} às {time} UTC. Reagende seu atendimento em Suporte."
    },
    "appointment_reschedule_proposed": {
      "title": "Propomos outro horário para o seu atendimento",
      "message": "Não podemos atender você em {date} às {time} UTC. A QLC propõe {newDate} às {newTime} UTC. Entre em Suporte para aceitá-lo."
    },
    "appointment_proposal_accepted": {
      "title": "Proposta de horário aceita",
      "message": "{clientName} aceitou o atendimento de {dateMx} às {timeMx}, horário do México ({date} {time} UTC)."
    },
    "appointment_proposal_declined": {
      "title": "Proposta de horário não aceita",
      "message": "{clientName} não aceitou o horário proposto ({dateMx} {timeMx}, horário do México · {date} {time} UTC)."
    },
    "payment_status_updated": {
      "title": "Atualização da sua transferência informada",
      "message": "Sua transferência interna Bitget (ordem {orderNumber}) foi marcada como: {status}"
    },
    "payment_reported": {
      "title": "Transferência interna Bitget informada",
      "message": "{clientName} informou uma transferência interna Bitget (ordem {orderNumber})."
    },
    "appointment_status_updated": {
      "title": "Atualização do seu agendamento",
      "message": "Sua solicitação de agendamento foi: {status}"
    },
    "appointment_requested": {
      "title": "Nova solicitação de agendamento",
      "message": "{clientName} solicitou um agendamento para {date} às {time}."
    },
    "appointment_requested_self": {
      "title": "Seu agendamento foi criado com sucesso",
      "message": "Sua solicitação de agendamento para {date} às {time} foi enviada e aguarda a resposta da QLC."
    },
    "appointment_confirmed": {
      "title": "Seu agendamento foi confirmado",
      "message": "Seu agendamento foi confirmado para {date} às {time}. Não se esqueça!"
    },
    "appointment_confirmed_utc": {
      "title": "Seu agendamento foi confirmado",
      "message": "Seu agendamento foi confirmado para {date} às {time} UTC. Não se esqueça!"
    },
    "appointment_requested_utc": {
      "title": "Nova solicitação de agendamento",
      "message": "{clientName} solicitou um agendamento para {dateMx} às {timeMx}, horário do México ({date} {time} UTC)."
    },
    "appointment_requested_self_utc": {
      "title": "Seu agendamento foi criado com sucesso",
      "message": "Sua solicitação de agendamento para {date} às {time} UTC foi enviada e aguarda a resposta da QLC."
    },
    "appointment_rejected": {
      "title": "Seu agendamento foi recusado",
      "message": "Sua solicitação de agendamento foi recusada."
    },
    "document_resubmit": {
      "title": "Você pode enviar seu documento novamente",
      "message": "A QLC excluiu seu documento de \"{category}\". Você já pode enviar um novo."
    },
    "document_submitted": {
      "title": "Documento entregue",
      "message": "Recebemos seu documento da categoria \"{category}\"."
    },
    "document_submitted_admin": {
      "title": "Documento enviado por um cliente",
      "message": "{clientName} enviou um documento da categoria \"{category}\"."
    },
    "api_connection_status_updated": {
      "title": "Atualização da sua conexão API",
      "message": "Status da sua conexão API: {status}"
    },
    "api_connection_auto_disconnected": {
      "title": "Conexão API desativada",
      "message": "O prazo de pagamento da sua comissão terminou e sua conexão API {identifier} foi desativada para operações futuras. Ela será reativada quando o pagamento for informado e validado."
    },
    "api_connection_auto_disconnected_admin": {
      "title": "Conexão API desativada por prazo vencido",
      "message": "O prazo de 72 horas para o pagamento da comissão de {clientName} ({identifier}) venceu sem que o pagamento fosse recebido. A conexão API dele foi desativada automaticamente."
    },
    "statement_generated": {
      "title": "Extrato gerado — pendente de pagamento",
      "message": "Seu extrato de {month} ({identifier}) foi gerado e está PENDENTE DE PAGAMENTO. Você pode baixar o PDF na sua subconta (ele também chegou anexado por e-mail). Você tem {commissionDueHours} horas para pagá-lo por Transferência interna Bitget em Pagamentos / Garantia."
    },
    "statement_paid": {
      "title": "Extrato pago",
      "message": "O pagamento do seu extrato ({identifier}) foi confirmado pela QLC. Status: PAGO."
    },
    "statement_deadline_warning": {
      "title": "Seu extrato está prestes a vencer",
      "message": "Restam aproximadamente {hoursLeft} horas para pagar o extrato da sua subconta/API {identifier}. Se o prazo vencer sem pagamento, a conexão API será desativada."
    },
    "statement_deadline_warning_admin": {
      "title": "Extrato de um cliente prestes a vencer",
      "message": "Restam aproximadamente {hoursLeft} horas para que {clientName} ({identifier}) pague o extrato."
    },
    "process_condition_updated": {
      "title": "Atualização do seu processo",
      "message": "{conditionType}: {status}"
    },
    "process_activated": {
      "title": "Conta ativada",
      "message": "Sua conta QLC foi ativada."
    },
    "subaccount_deactivated": {
      "title": "Conta desativada",
      "message": "Sua conta QLC ({identifier}) foi desativada e voltou a ficar em análise."
    },
    "case_created_self": {
      "title": "Seu caso foi criado com sucesso",
      "message": "Seu caso #{caseNumber} foi registrado. A QLC o revisará em breve."
    },
    "chat_session_ended": {
      "title": "Chat de 15 minutos encerrado",
      "message": "A sessão de chat com {clientName} foi encerrada. Você já pode baixar a conversa em PDF em Suporte."
    },
    "affiliate_code_request_admin": {
      "title": "Solicitação de código de afiliação",
      "message": "{prospectName} ({email}) solicitou um código de afiliação para se cadastrar. Envie um por e-mail em até 24 horas."
    },
    "new_prospect_admin": {
      "title": "Novo prospect",
      "message": "{prospectName} ({email}) solicitou informações sobre a QLC."
    },
    "new_prospect_admin_message": {
      "title": "Novo prospect",
      "message": "{prospectName} ({email}) solicitou informações sobre a QLC. Mensagem: “{message}”"
    },
    "new_client_registered_admin": {
      "title": "Novo cliente cadastrado",
      "message": "{clientName} ({email}) se cadastrou na QLC."
    },
    "new_admin_registered_admin": {
      "title": "Novo administrador cadastrado",
      "message": "{adminName} ({email}) foi cadastrado como administrador."
    },
    "account_deletion_requested_admin": {
      "title": "Solicitação de exclusão de conta",
      "message": "{clientName} ({username}) solicitou excluir a conta após verificar a senha e o Google Authenticator. O acesso dele foi desativado; os dados são mantidos até o tratamento conforme a política aplicável."
    },
    "welcome": {
      "title": "Bem-vindo à QLC",
      "message": "Sua conta foi criada. Conclua seu processo para começar."
    },
    "api_permissions_guide": {
      "title": "IMPORTANTE — Configure corretamente as permissões da sua API",
      "message": "Antes de registrar ou configurar sua API da Bitget, consulte o Guia de Uso — Permissões de API. Lá você encontrará as permissões correspondentes ao seu tipo de conta e as indicações sobre quando deve adicionar um endereço IP.",
      "action": "Ver guia de permissões de API"
    },
    "affiliate_payment_paid": {
      "title": "Pagamento de comissão de afiliado",
      "message": "A QLC registrou o pagamento da sua comissão de afiliado ({amount} {currency}, período {period}).",
      "requires": "i18n"
    },
    "capital_distribution_report_updated": {
      "title": "Atualização do seu relatório de distribuição de capital",
      "message": "Seu relatório de distribuição de capital ({amount} USDT) foi marcado como: {status}",
      "requires": "i18n"
    },
    "document_unlocked": {
      "title": "Você pode substituir um documento",
      "message": "A QLC habilitou temporariamente seu documento de \"{category}\" para que você possa excluí-lo e enviá-lo novamente.",
      "requires": "i18n"
    },
    "affiliate_commission_created": {
      "title": "[[prepaid:Comissão de afiliado paga]][[pending:Nova comissão de afiliado]]",
      "message": "Foi emitido um extrato de um dos seus indicados. [[prepaid:Sua comissão do período ({amount} USDT) já foi PAGA pela QLC no seu UID da Bitget.]][[pending:Sua comissão do período é de {amount} USDT (pendente de aprovação e pagamento pela QLC).]]",
      "requires": "i18n"
    },
    "support_case_message": {
      "title": "[[content:Nova mensagem]][[fileName:Novo arquivo]] no seu caso #{caseNumber}",
      "message": "[[content:{content}]][[fileName:A QLC anexou \"{fileName}\".]]",
      "requires": "i18n"
    },
    "capital_distribution_reported": {
      "title": "Distribuição de capital informada",
      "message": "{clientName} informou que já distribuiu {amount} USDT[[identifier: na subconta/API {identifier}]].",
      "requires": "i18n"
    },
    "document_corrected_admin": {
      "title": "Documento corrigido recebido",
      "message": "{clientName} enviou uma correção do documento na categoria \"{category}\".",
      "requires": "i18n"
    },
    "support_case_created": {
      "title": "Novo caso de suporte",
      "message": "{clientName} registrou o caso #{caseNumber}: \"{subject}\"",
      "requires": "i18n"
    },
    "support_case_message_admin": {
      "title": "[[content:Nova mensagem]][[fileName:Novo arquivo]] do cliente no caso #{caseNumber}",
      "message": "{clientName}[[content:: {content}]][[fileName: anexou \"{fileName}\".]]",
      "requires": "i18n"
    },
    "subaccount_request_created_admin": {
      "title": "Nova solicitação de subconta",
      "message": "{clientName} solicitou uma subconta/API adicional ({activeCount}/{max} ativas).[[reason: Motivo: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_deactivate_request_created_admin": {
      "title": "Solicitação de desativação de subconta",
      "message": "{clientName} solicitou desativar a subconta/API {subaccount}.[[reason: Motivo: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_request_approved": {
      "title": "Nova subconta aprovada",
      "message": "A QLC aprovou sua solicitação de uma subconta adicional[[requiredCapital: — capital operacional exigido: {requiredCapital} USDT]].",
      "requires": "i18n"
    },
    "subaccount_request_rejected": {
      "title": "Solicitação de nova subconta recusada",
      "message": "A QLC analisou sua solicitação de uma subconta adicional e, por enquanto, não foi possível habilitá-la.[[reason: Motivo: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_deactivate_request_rejected": {
      "title": "Solicitação de desativação recusada",
      "message": "A QLC analisou sua solicitação para desativar sua [[principal:conta PRINCIPAL]][[slot:Subconta #{slot}]] e, por enquanto, não foi possível autorizá-la.[[reason: Motivo: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_activated": {
      "title": "Subconta ativada",
      "message": "A QLC ativou sua [[principal:conta PRINCIPAL]][[slot:Subconta #{slot}]]. Você já pode vê-la no seu painel.",
      "requires": "i18n"
    }
  },
  "statusLabelKeys": {
    "payment_status_updated": {
      "status": {
        "PENDING": "status.paymentReport.pending",
        "EN_REVISION": "status.paymentReport.inReview",
        "GARANTIA_REPORTADA": "status.paymentReport.guaranteeReported",
        "APROBADO": "status.paymentReport.approved",
        "RECHAZADO": "status.paymentReport.rejected"
      }
    },
    "appointment_status_updated": {
      "status": {
        "PENDING": "status.appointment.pending",
        "AUTORIZADA": "status.appointment.authorized",
        "RECHAZADA": "status.appointment.rejected",
        "COMPLETADA": "status.appointment.completed",
        "CANCELADA": "status.appointment.cancelled"
      }
    },
    "api_connection_status_updated": {
      "status": {
        "CONECTADA": "status.apiConnection.connected",
        "DESCONECTADA": "status.apiConnection.disconnected",
        "PENDIENTE": "status.apiConnection.pending"
      }
    },
    "process_condition_updated": {
      "status": {
        "PENDING": "status.condition.pending",
        "CONFIRMED": "status.condition.completed",
        "REJECTED": "status.condition.rejected"
      },
      "conditionType": {
        "FUNDS": "status.conditionType.FUNDS",
        "PAYMENT": "status.conditionType.PAYMENT",
        "API": "status.conditionType.API",
        "ACTIVATION": "status.conditionType.ACTIVATION"
      }
    },
    "document_resubmit": {
      "category": {
        "identificacion": "clientDocuments.categoryId",
        "otro": "clientDocuments.categoryOther"
      }
    },
    "document_submitted": {
      "category": {
        "identificacion": "clientDocuments.categoryId",
        "otro": "clientDocuments.categoryOther"
      }
    },
    "document_submitted_admin": {
      "category": {
        "identificacion": "clientDocuments.categoryId",
        "otro": "clientDocuments.categoryOther"
      }
    },
    "document_unlocked": {
      "category": {
        "identificacion": "clientDocuments.categoryId",
        "otro": "clientDocuments.categoryOther"
      }
    },
    "document_corrected_admin": {
      "category": {
        "identificacion": "clientDocuments.categoryId",
        "otro": "clientDocuments.categoryOther"
      }
    },
    "capital_distribution_report_updated": {
      "status": {
        "PENDING": "status.paymentReport.pending",
        "EN_REVISION": "status.paymentReport.inReview",
        "APROBADO": "status.paymentReport.approved",
        "RECHAZADO": "status.paymentReport.rejected"
      }
    }
  },
  "labels": {
    "status.paymentReport.pending": "Aguardando análise",
    "status.paymentReport.inReview": "Em análise",
    "status.paymentReport.guaranteeReported": "Garantia informada",
    "status.paymentReport.approved": "Aprovado",
    "status.paymentReport.rejected": "Recusado",
    "status.appointment.pending": "Aguardando resposta",
    "status.appointment.authorized": "Autorizado",
    "status.appointment.rejected": "Recusado",
    "status.appointment.completed": "Concluído",
    "status.appointment.cancelled": "Cancelado",
    "status.apiConnection.connected": "Conectada",
    "status.apiConnection.disconnected": "Desconectada",
    "status.apiConnection.pending": "Pendente",
    "status.condition.pending": "Pendente",
    "status.condition.completed": "Concluído",
    "status.condition.rejected": "Recusado",
    "status.conditionType.FUNDS": "Capital distribuído na exchange",
    "status.conditionType.PAYMENT": "Garantia informada",
    "status.conditionType.API": "Conexão API",
    "status.conditionType.ACTIVATION": "Ativação",
    "clientDocuments.categoryId": "Identificação",
    "clientDocuments.categoryOther": "Outro"
  }
};
