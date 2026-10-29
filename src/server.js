require('dotenv').config({ quiet: true });
const app = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Fastor CRM API server listening on port ${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await db.pool.end();
      console.log('Database pool closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
