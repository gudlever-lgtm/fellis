import mysql from 'mysql2/promise'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
try { process.loadEnvFile(resolve(__dirname, '.env')) } catch { /* .env optional */ }

let pool

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'fellis_eu',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    })
  }
  return pool
}

// Default export for backwards compat — lazy proxy
export default new Proxy({}, {
  get(_, prop) {
    return getPool()[prop]
  }
})
