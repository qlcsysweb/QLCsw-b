-- RONDA: capital 100–2,000 USDT, modelo de participación 50/50, declaración de
-- capital operativo y adjuntos en mensajes admin→cliente.
-- (Este archivo se aplica sentencia por sentencia separando por punto y coma,
-- por eso ningún texto de abajo contiene ese carácter.)

-- 1) Declaración escrita del cliente al confirmar su capital operativo.
ALTER TABLE "capital_distribution_reports" ADD COLUMN "declaration" TEXT;

-- 2) Adjuntos de mensajes manuales admin→cliente (solo metadata, binario en Drive).
CREATE TABLE "notification_attachments" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveFolderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notification_attachments_notificationId_idx" ON "notification_attachments"("notificationId");
ALTER TABLE "notification_attachments" ADD CONSTRAINT "notification_attachments_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Rango de capital: 20 → 100 USDT, 400 → 2,000 USDT (solo textos que aún
--    conservan el valor original, para no pisar ediciones del CMS).
UPDATE "public_content" SET "value" = 'Accesible desde 100 USDT.', "valueEn" = 'Accessible starting at 100 USDT.'
WHERE "section" = 'hero' AND "key" = 'title_line2' AND "value" = 'Accesible desde 20 USDT.';

UPDATE "public_content" SET "value" = 'Trading institucional. Accesible desde 100 USDT.', "valueEn" = 'Institutional trading. Accessible from 100 USDT.'
WHERE "section" = 'footer' AND "key" = 'tagline' AND "value" = 'Trading institucional. Accesible desde 20 USDT.';

UPDATE "public_content" SET "value" = '100–2,000 USDT', "valueEn" = '100–2,000 USDT'
WHERE "section" = 'microposiciones' AND "key" = 'range' AND "value" = '20–400 USDT';

UPDATE "public_content" SET "value" = 'Desde 100 USDT.', "valueEn" = 'Starting from 100 USDT.'
WHERE "section" = 'problema' AND "key" = 'body_6' AND "value" = 'Desde 20 USDT.';

UPDATE "faqs"
SET "answer" = 'La arquitectura comercial de QLC está diseñada para operar con cuentas individuales desde 100 USDT hasta 2,000 USDT.',
    "answerEn" = 'QLC''s commercial architecture is designed to operate with individual accounts ranging from 100 USDT to 2,000 USDT.'
WHERE "answer" = 'La arquitectura comercial de QLC está diseñada para operar con cuentas individuales desde 20 USDT hasta 400 USDT.';

UPDATE "process_steps"
SET "descriptionEs" = 'Confirma que tu cuenta de Exchange tenga disponible el capital operativo requerido (desde 100 USDT) y repórtalo en Conexión API.',
    "descriptionEn" = 'Confirm your Exchange account has the required operating capital available (from 100 USDT) and report it in API Connection.'
WHERE "descriptionEs" = 'Confirma que tu cuenta de Exchange tenga disponibles 20 USDT y repórtalo en Conexión API.';

-- 4) Modelo de participación: QLC 50% / Cliente 50% + contenido nuevo.
UPDATE "models"
SET "percentage" = '50/50',
    "conditions" = 'QLC: 50% · Cliente: 50%',
    "conditionsEn" = 'QLC: 50% · Client: 50%',
    "tagline" = 'Ganamos juntos',
    "taglineEn" = 'We win together',
    "description" = 'El modelo de participación está diseñado para que la remuneración de QLC esté directamente relacionada con el resultado generado. QLC participa únicamente de la ganancia efectivamente generada durante el período — no se aplica el porcentaje sobre el capital inicial.',
    "descriptionEn" = 'The participation model is designed so that QLC''s compensation is directly tied to the result generated. QLC only participates in the profit effectively generated during the period — the percentage is never applied to the initial capital.',
    "detailsContent" = E'¿Cómo funciona?\nLa distribución 50/50 se aplica exclusivamente sobre la utilidad efectivamente generada, nunca sobre el capital aportado.\n\nEjemplo — Capital de 100 USDT\nGanancia generada: 20 USDT → QLC recibe 10 USDT (50%) · Cliente recibe 10 USDT (50%) → Capital final: 110 USDT\nGanancia generada: 1 USDT → QLC recibe 0.50 USDT · Cliente recibe 0.50 USDT → Capital final: 100.50 USDT\n\nSi se generan 0 USDT, QLC recibe 0 USDT.\n\nCaracterísticas principales\n• Sin cobros sobre el capital: el porcentaje se calcula sobre la ganancia.\n• Pago únicamente sobre resultados efectivamente generados.\n• Modelo totalmente proporcional al desempeño.\n• La remuneración de QLC está directamente vinculada al resultado real obtenido.\n\n¿Para quién está pensado?\n"No quiero que QLC cobre sobre mi capital. Prefiero que su participación dependa directamente de las ganancias que realmente genere."',
    "detailsContentEn" = E'How does it work?\nThe 50/50 split applies exclusively to the profit effectively generated, never to the capital contributed.\n\nExample — 100 USDT capital\nProfit generated: 20 USDT → QLC receives 10 USDT (50%) · Client receives 10 USDT (50%) → Final capital: 110 USDT\nProfit generated: 1 USDT → QLC receives 0.50 USDT · Client receives 0.50 USDT → Final capital: 100.50 USDT\n\nIf 0 USDT is generated, QLC receives 0 USDT.\n\nMain characteristics\n• No charges on capital: the percentage is calculated on the profit.\n• Payment only on results effectively generated.\n• Fully performance-proportional model.\n• QLC\'s compensation is directly tied to the actual result obtained.\n\nWho is it designed for?\n"I don\'t want QLC to charge on my capital. I prefer its participation to depend directly on the profits it actually generates."'
WHERE "key" = 'PERFORMANCE';

UPDATE "process_steps"
SET "descriptionEs" = 'Tu subcuenta opera con el modelo de participación: QLC 50% · Cliente 50%.',
    "descriptionEn" = 'Your subaccount operates with the participation model: QLC 50% · Client 50%.'
WHERE "descriptionEs" = 'Tu subcuenta opera con el modelo de participación: QLC 70% · Cliente 30%.';
