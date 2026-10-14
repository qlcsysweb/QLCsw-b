// ARCHIVO GENERADO por scripts/sync-notification-email-templates.js — no editar a mano.
// Fuente: frontend/src/i18n/translations.js (en.notificationTemplates) y notificationMessages.js.
module.exports = {
  "templates": {
    "appointment_rejected_reschedule": {
      "title": "We cannot attend you at that time",
      "message": "We cannot attend you on {date} at {time} UTC. Please reschedule your appointment from Support."
    },
    "appointment_reschedule_proposed": {
      "title": "We propose another time for your appointment",
      "message": "We cannot attend you on {date} at {time} UTC. QLC proposes {newDate} at {newTime} UTC. Go to Support to accept it."
    },
    "appointment_proposal_accepted": {
      "title": "Proposed time accepted",
      "message": "{clientName} accepted the appointment on {dateMx} at {timeMx} Mexico time ({date} {time} UTC)."
    },
    "appointment_proposal_declined": {
      "title": "Proposed time not accepted",
      "message": "{clientName} did not accept the proposed time ({dateMx} {timeMx} Mexico time · {date} {time} UTC)."
    },
    "payment_status_updated": {
      "title": "Update on your reported transfer",
      "message": "Your Bitget internal transfer (order {orderNumber}) was marked as: {status}"
    },
    "payment_reported": {
      "title": "Bitget internal transfer reported",
      "message": "{clientName} reported a Bitget internal transfer (order {orderNumber})."
    },
    "appointment_status_updated": {
      "title": "Update on your appointment",
      "message": "Your appointment request was: {status}"
    },
    "appointment_requested": {
      "title": "New appointment request",
      "message": "{clientName} requested an appointment for {date} at {time}."
    },
    "appointment_requested_self": {
      "title": "Your appointment has been created",
      "message": "Your appointment request for {date} at {time} was sent and is awaiting QLC's response."
    },
    "appointment_confirmed": {
      "title": "Your appointment was confirmed",
      "message": "Your appointment was confirmed for {date} at {time}. Don't forget!"
    },
    "appointment_confirmed_utc": {
      "title": "Your appointment was confirmed",
      "message": "Your appointment was confirmed for {date} at {time} UTC. Don't forget!"
    },
    "appointment_requested_utc": {
      "title": "New appointment request",
      "message": "{clientName} requested an appointment for {dateMx} at {timeMx} Mexico time ({date} {time} UTC)."
    },
    "appointment_requested_self_utc": {
      "title": "Your appointment has been created",
      "message": "Your appointment request for {date} at {time} UTC was sent and is awaiting QLC's response."
    },
    "appointment_rejected": {
      "title": "Your appointment was rejected",
      "message": "Your appointment request was rejected."
    },
    "document_resubmit": {
      "title": "You can resubmit your document",
      "message": "QLC removed your document from \"{category}\". You can now upload a new one."
    },
    "document_submitted": {
      "title": "Document submitted",
      "message": "We received your document for the \"{category}\" category."
    },
    "document_submitted_admin": {
      "title": "Document uploaded by a client",
      "message": "{clientName} uploaded a document for the \"{category}\" category."
    },
    "api_connection_status_updated": {
      "title": "Update on your API connection",
      "message": "Your API connection status: {status}"
    },
    "api_connection_auto_disconnected": {
      "title": "API connection disconnected",
      "message": "The commission payment deadline was reached and your API connection {identifier} was disconnected for future operations. It will be reactivated once the payment is reported and validated."
    },
    "api_connection_auto_disconnected_admin": {
      "title": "API connection disconnected — deadline expired",
      "message": "The 72-hour commission payment deadline for {clientName} ({identifier}) expired without payment. Their API connection was automatically disconnected."
    },
    "statement_generated": {
      "title": "Statement generated — pending payment",
      "message": "Your {month} statement ({identifier}) was generated and is PENDING PAYMENT. You can download the PDF from your subaccount (it was also attached to your email). You have {commissionDueHours} hours to pay it via Bitget internal transfer from Payments / Guarantee."
    },
    "statement_paid": {
      "title": "Statement paid",
      "message": "The payment of your statement ({identifier}) was confirmed by QLC. Status: PAID."
    },
    "statement_deadline_warning": {
      "title": "Your statement is about to expire",
      "message": "About {hoursLeft} hours remain to pay the statement of your subaccount/API {identifier}. If the deadline passes without payment, the API connection will be disabled."
    },
    "statement_deadline_warning_admin": {
      "title": "A client's statement is about to expire",
      "message": "About {hoursLeft} hours remain for {clientName} ({identifier}) to pay their statement."
    },
    "process_condition_updated": {
      "title": "Update on your process",
      "message": "{conditionType}: {status}"
    },
    "process_activated": {
      "title": "Account activated",
      "message": "Your QLC account has been activated."
    },
    "subaccount_deactivated": {
      "title": "Account deactivated",
      "message": "Your QLC account ({identifier}) was deactivated and is under review again."
    },
    "case_created_self": {
      "title": "Your case has been created",
      "message": "Your case #{caseNumber} was registered. QLC will review it soon."
    },
    "chat_session_ended": {
      "title": "15-minute chat finished",
      "message": "The chat session with {clientName} finished. You can now download the conversation as a PDF from Support."
    },
    "new_prospect_admin": {
      "title": "New prospect",
      "message": "{prospectName} ({email}) requested information about QLC."
    },
    "new_prospect_admin_message": {
      "title": "New prospect",
      "message": "{prospectName} ({email}) requested information about QLC. Message: “{message}”"
    },
    "new_client_registered_admin": {
      "title": "New client registered",
      "message": "{clientName} ({email}) registered on QLC."
    },
    "new_admin_registered_admin": {
      "title": "New administrator registered",
      "message": "{adminName} ({email}) was registered as an administrator."
    },
    "affiliate_payment_paid": {
      "title": "Affiliate commission payment",
      "message": "QLC registered the payment of your affiliate commission ({amount} {currency}, period {period}).",
      "requires": "i18n"
    },
    "capital_distribution_report_updated": {
      "title": "Update on your capital distribution report",
      "message": "Your capital distribution report ({amount} USDT) was marked as: {status}",
      "requires": "i18n"
    },
    "document_unlocked": {
      "title": "You can replace a document",
      "message": "QLC temporarily enabled your \"{category}\" document so you can delete it and submit it again.",
      "requires": "i18n"
    },
    "affiliate_commission_created": {
      "title": "[[prepaid:Affiliate commission paid]][[pending:New affiliate commission]]",
      "message": "A statement for one of your referrals was issued. [[prepaid:Your commission for the period ({amount} USDT) has already been PAID by QLC to your Bitget UID.]][[pending:Your commission for the period is {amount} USDT (pending approval and payment by QLC).]]",
      "requires": "i18n"
    },
    "support_case_message": {
      "title": "[[content:New message]][[fileName:New file]] in your case #{caseNumber}",
      "message": "[[content:{content}]][[fileName:QLC attached \"{fileName}\".]]",
      "requires": "i18n"
    },
    "capital_distribution_reported": {
      "title": "Capital distribution reported",
      "message": "{clientName} reported that they already distributed {amount} USDT[[identifier: in subaccount/API {identifier}]].",
      "requires": "i18n"
    },
    "document_corrected_admin": {
      "title": "Corrected document received",
      "message": "{clientName} sent a correction of their document in the \"{category}\" category.",
      "requires": "i18n"
    },
    "support_case_created": {
      "title": "New support case",
      "message": "{clientName} registered case #{caseNumber}: \"{subject}\"",
      "requires": "i18n"
    },
    "support_case_message_admin": {
      "title": "[[content:New message]][[fileName:New file]] from the client in case #{caseNumber}",
      "message": "{clientName}[[content:: {content}]][[fileName: attached \"{fileName}\".]]",
      "requires": "i18n"
    },
    "subaccount_request_created_admin": {
      "title": "New subaccount request",
      "message": "{clientName} requested an additional subaccount/API ({activeCount}/{max} active).[[reason: Reason: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_deactivate_request_created_admin": {
      "title": "Subaccount deactivation request",
      "message": "{clientName} requested to deactivate subaccount/API {subaccount}.[[reason: Reason: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_request_approved": {
      "title": "New subaccount approved",
      "message": "QLC approved your request for an additional subaccount[[requiredCapital: — required operating capital: {requiredCapital} USDT]].",
      "requires": "i18n"
    },
    "subaccount_request_rejected": {
      "title": "New subaccount request rejected",
      "message": "QLC reviewed your request for an additional subaccount and, for now, it was not possible to enable it.[[reason: Reason: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_deactivate_request_rejected": {
      "title": "Deactivation request rejected",
      "message": "QLC reviewed your request to deactivate your [[principal:PRINCIPAL account]][[slot:Subaccount #{slot}]] and, for now, it was not possible to authorize it.[[reason: Reason: {reason}]]",
      "requires": "i18n"
    },
    "subaccount_activated": {
      "title": "Subaccount activated",
      "message": "QLC activated your [[principal:PRINCIPAL account]][[slot:Subaccount #{slot}]]. You can now see it in your panel.",
      "requires": "i18n"
    },
    "account_deletion_requested_admin": {
      "title": "Account deletion request",
      "message": "{clientName} ({username}) requested the deletion of their account after verifying their password and Google Authenticator. Their access was disabled; their data is kept until it is processed according to the applicable policy."
    },
    "welcome": {
      "title": "Welcome to QLC",
      "message": "Your account was created. Complete your process to get started."
    },
    "api_permissions_guide": {
      "title": "IMPORTANT — Set up your API permissions correctly",
      "message": "Before registering or configuring your Bitget API, review the Usage Guide — API Permissions. There you will find the permissions for your account type and when you need to add an IP address.",
      "action": "View API permissions guide"
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
    "status.paymentReport.pending": "Awaiting review",
    "status.paymentReport.inReview": "Under review",
    "status.paymentReport.guaranteeReported": "Guarantee reported",
    "status.paymentReport.approved": "Approved",
    "status.paymentReport.rejected": "Rejected",
    "status.appointment.pending": "Awaiting response",
    "status.appointment.authorized": "Authorized",
    "status.appointment.rejected": "Rejected",
    "status.appointment.completed": "Completed",
    "status.appointment.cancelled": "Cancelled",
    "status.apiConnection.connected": "Connected",
    "status.apiConnection.disconnected": "Disconnected",
    "status.apiConnection.pending": "Pending",
    "status.condition.pending": "Pending",
    "status.condition.completed": "Completed",
    "status.condition.rejected": "Rejected",
    "status.conditionType.FUNDS": "Capital distributed on the exchange",
    "status.conditionType.PAYMENT": "Guarantee reported",
    "status.conditionType.API": "API connection",
    "status.conditionType.ACTIVATION": "Activation",
    "clientDocuments.categoryId": "Identification",
    "clientDocuments.categoryOther": "Other"
  }
};
