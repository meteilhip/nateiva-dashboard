const fs = require("fs");
const path = require("path");
const { pool, closePool } = require("../db");

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function main() {
  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const statements = sql
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }

  if (!(await columnExists("followups", "deleted_at"))) {
    await pool.query(`ALTER TABLE followups ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL`);
  }
  if (!(await columnExists("followups", "deleted_by_username"))) {
    await pool.query(`ALTER TABLE followups ADD COLUMN deleted_by_username VARCHAR(120) NOT NULL DEFAULT ''`);
  }
  if (!(await indexExists("followups", "followups_deleted_at_idx"))) {
    await pool.query(`ALTER TABLE followups ADD KEY followups_deleted_at_idx (deleted_at)`);
  }
  console.log("nateiva-sale-analytic-api migrations complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
