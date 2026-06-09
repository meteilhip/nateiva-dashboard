const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT || 4310),
  nodeEnv: process.env.NODE_ENV || "development",
  apiName: process.env.NATEIVA_SALE_ANALYTIC_API_NAME || "nateiva-sale-analytic-api",
  db: {
    host: requireEnv("DB_HOST", "127.0.0.1"),
    port: Number(process.env.DB_PORT || 3306),
    name: requireEnv("DB_NAME", "nateiva_sale_analytic_prod"),
    user: requireEnv("DB_USER", "nateiva_sale_analytic_app"),
    password: requireEnv("DB_PASSWORD")
  },
  jwtSecret: requireEnv("JWT_SECRET"),
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  defaultCallCount: Number(process.env.DEFAULT_CALL_COUNT || 130)
};
