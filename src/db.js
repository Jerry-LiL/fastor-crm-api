const { Pool } = require('pg');
require('dotenv').config({ quiet: true });

const connectionString =
  process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/fastor_crm_test'
    : process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/fastor_crm';

const pool = new Pool({
  connectionString,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
