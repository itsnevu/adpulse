// PostgreSQL connection pool. Single shared pool for the whole process.
const { Pool, types } = require("pg");
const config = require("../config");

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Date
// objects — the whole API contract works with date strings.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  // Errors on idle clients should not crash the process.
  console.error("[db] unexpected error on idle client:", err.message);
});

module.exports = pool;
