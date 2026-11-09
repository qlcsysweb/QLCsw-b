// CORRECCIÓN 6/18 (bloque de 20) — validación de formato de IP (IPv4/IPv6)
// puramente para el dato administrativo "IP requerida" de una subcuenta/API.
// Nunca se conecta ni se valida contra el exchange.
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:$|^:(:[0-9a-fA-F]{1,4}){1,7}$|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$/;

function isValidIp(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  return IPV4_RE.test(value.trim()) || IPV6_RE.test(value.trim());
}

module.exports = { isValidIp };
