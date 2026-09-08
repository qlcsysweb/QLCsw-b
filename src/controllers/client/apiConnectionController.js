const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

// Solo lectura de ESTADO — el cliente nunca ve ni gestiona la API key/secret,
// y esta plataforma nunca se conecta al exchange ni ejecuta operaciones.
const getApiConnection = asyncHandler(async (req, res) => {
  const connection = await prisma.apiConnection.findUnique({
    where: { clientId: req.clientProfile.id },
  });
  if (!connection) throw ApiError.notFound('Conexión API no encontrada');

  res.json({
    ok: true,
    connection: {
      exchangeName: connection.exchangeName,
      status: connection.status,
      updatedAt: connection.updatedAt,
    },
  });
});

module.exports = { getApiConnection };
