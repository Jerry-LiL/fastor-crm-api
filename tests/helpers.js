process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/fastor_crm_test';

const db = require('../src/db');
const { runMigration } = require('../scripts/migrate');

async function ensureMigrated() {
  await runMigration(process.env.TEST_DATABASE_URL);
}

async function truncateTables() {
  await db.query('TRUNCATE TABLE enquiries, employees RESTART IDENTITY CASCADE;');
}

async function closeDb() {
  await db.pool.end();
}

module.exports = {
  ensureMigrated,
  truncateTables,
  closeDb,
};
