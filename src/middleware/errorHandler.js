const ApiError = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, next) {
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
