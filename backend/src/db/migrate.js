// Run the schema migration: executes database/schema.sql from the repo root.
// The schema file is the source of truth and is fully idempotent
// (CREATE TABLE IF NOT EXISTS), so this script can be run repeatedly.
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

const SCHEMA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "database",
  "schema.sql"
);

async function migrate() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Schema file tidak ditemukan: ${SCHEMA_PATH}`);
  }
  const sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  console.log(`[migrate] menjalankan ${SCHEMA_PATH} ...`);
  await pool.query(sql);
  console.log("[migrate] selesai — semua tabel siap.");
}

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate] gagal:", err.message);
    pool.end().finally(() => process.exit(1));
  });
