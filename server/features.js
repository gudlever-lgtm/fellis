import pool from './db.js'

export async function userHasFeature(userId, feature) {
  try {
    const [[row]] = await pool.query(
      `SELECT 1 FROM user_features
       WHERE user_id = ? AND feature = ? AND active = 1
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId, feature]
    )
    return !!row
  } catch {
    return false
  }
}
