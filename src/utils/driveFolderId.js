// El admin puede pegar el Folder ID "pelón" o la URL completa que copia del
// navegador al abrir la carpeta en Google Drive — nunca se guarda la URL
// completa en DB, solo el ID ya normalizado (ver driveConfigController.js).
function extractDriveFolderId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // https://drive.google.com/drive/folders/ID  y  .../drive/u/<n>/folders/ID
  let match = trimmed.match(/drive\.google\.com\/drive(?:\/u\/\d+)?\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // Formato antiguo: https://drive.google.com/open?id=ID (o cualquier URL con ?id=/&id=)
  match = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // Ya es un Folder ID "pelón" (compatibilidad con lo ya guardado antes de este cambio).
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;

  return null;
}

module.exports = { extractDriveFolderId };
