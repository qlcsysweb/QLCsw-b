require('dotenv').config();
const app = require('./app');
const { startStatementExpirySweep } = require('./utils/connectionDeadlines');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`QLC backend escuchando en http://localhost:${PORT}`);
  // Vencimiento de estados de cuenta (72 h) aunque nadie tenga la página abierta.
  startStatementExpirySweep();
});
