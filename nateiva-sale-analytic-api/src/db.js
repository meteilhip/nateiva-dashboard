const mysql = require("mysql2/promise");
const { db } = require("./config");

const pool = mysql.createPool({
  host: db.host,
  port: db.port,
  user: db.user,
  password: db.password,
  database: db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true
});

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  closePool
};
