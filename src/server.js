import './shared/loadEnv.js';
import app from './app.js';
import { disconnectEducationDb, startEducationTasks } from './modules/education/startup.js';
import { disconnectTradingDb, startTradingTasks } from './modules/trading/startup.cjs';

const PORT = Number(process.env.PORT) || 4000;

let stopTasks = [];

const server = app.listen(PORT, '0.0.0.0', () => {
  console.info(`[qlc] Servidor iniciado en puerto ${PORT} (${process.env.NODE_ENV || 'development'})`);
  if (process.env.SKIP_STARTUP_TASKS === 'true') {
    console.info('[qlc] SKIP_STARTUP_TASKS=true: tareas de arranque y programadas omitidas');
    return;
  }
  stopTasks = [startEducationTasks(), startTradingTasks()];
});

function shutdown(signal) {
  console.info(`[qlc] ${signal} recibido, cerrando...`);
  stopTasks.forEach((stop) => stop());
  server.close(async () => {
    await Promise.allSettled([disconnectEducationDb(), disconnectTradingDb()]);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
