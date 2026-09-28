-- Página pública: las 4 cards del hero y la sección Resultados dejan de
-- mostrar "#XXX / Clasificación actual / Track Record" y pasan a mostrar
-- ROI 30D y Tasa de éxito, administrables desde el mismo formulario
-- (Admin → Track Record). Columnas opcionales: sin valor configurado el
-- sitio público muestra "—", nunca una cifra inventada.
ALTER TABLE "track_records" ADD COLUMN "roi30d" DECIMAL(10,2);
ALTER TABLE "track_records" ADD COLUMN "winRate" DECIMAL(5,2);

-- Textos por defecto que hablaban de "track record": se reemplazan SOLO si
-- siguen siendo exactamente el texto original del seed (si el admin ya los
-- personalizó desde el CMS, no se tocan).
UPDATE "public_content"
SET "value" = 'No te pedimos que confíes ciegamente en nosotros. Te damos acceso a una referencia externa para que puedas consultar directamente en Bitget los indicadores de rendimiento del perfil.',
    "valueEn" = 'We do not ask you to trust us blindly. We give you access to an external reference so you can review the profile performance indicators directly on Bitget.'
WHERE "section" = 'resultados' AND "key" = 'lead_1'
  AND "value" = 'No te pedimos que confíes ciegamente en nosotros. Te damos acceso a una referencia externa para que puedas verificar nuestro track record directamente en Bitget.';

UPDATE "track_records"
SET "description" = 'Los indicadores de rendimiento pueden consultarse directamente en Bitget, incluyendo el ROI de 30 días y la tasa de éxito. Son datos históricos de carácter informativo y no constituyen una garantía de resultados futuros.',
    "descriptionEn" = 'Performance indicators can be reviewed directly on Bitget, including the 30-day ROI and the win rate. They are historical, informational data and do not constitute a guarantee of future results.'
WHERE "description" = 'De esta manera, el rendimiento que puedes verificar corresponde a una fuente pública e independiente de QLC.';
