const normalize = (value) => `/${String(value || '/trad').replace(/^\/+|\/+$/g, '')}`;

const TRADING_BASE_PATH = normalize(process.env.GATEWAY_SECONDARY_PATH);
const TRADING_API_PATH = `${TRADING_BASE_PATH}/api`;

process.env.TRAD_COOKIE_NAME ||= 'trad_session';

module.exports = { TRADING_BASE_PATH, TRADING_API_PATH };
