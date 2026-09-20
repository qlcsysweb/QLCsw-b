const ApiError = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

// CORRECCIÓN — un `schema.parse(req.body)` de Zod que falla (campo
// obligatorio faltante, texto demasiado largo, email inválido, etc.) lanza
// un ZodError, que ANTES caía aquí sin manejo específico y se mostraba como
// un 500 genérico ("Ocurrió un problema inesperado") en vez del 400 con el
// mensaje de validación real que el usuario necesita ver. Afecta a todos
// los formularios del sistema, no solo a uno — se corrige en un solo lugar.
function isZodError(err) {
  return err?.name === 'ZodError' && Array.isArray(err?.issues);
}

function humanizeZodError(err) {
  const first = err.issues[0];
  return first?.message || 'Los datos enviados no son válidos.';
}

function errorHandler(err, req, res, next) {
  if (isZodError(err)) {
    err = ApiError.badRequest(humanizeZodError(err), err.issues);
  }
  const statusCode = err instanceof ApiError ? err.statusCode : err.statusCode || 500;

  // Los errores no controlados (500) NUNCA muestran el mensaje técnico real al
  // usuario (evita cosas como "PrismaClientKnownRequestError" en pantalla) —
  // solo los errores deliberados de ApiError (400/401/403/404/409/422/503),
  // que ya llevan mensajes humanos escritos por nosotros, se muestran tal cual.
  const message =
    statusCode === 500
      ? 'Ocurrió un problema inesperado. Intenta nuevamente en unos segundos.'
      : err.message || 'Ocurrió un problema. Intenta nuevamente.';

  if (statusCode === 500) {
    console.error('[ERROR]', err);
  }

  res.status(statusCode).json({
    ok: false,
    message,
    details: err instanceof ApiError ? err.details : undefined,
  });
}

module.exports = { notFoundHandler, errorHandler };
