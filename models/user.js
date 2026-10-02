const pool = require("../db/pool");

/**
 * Parse a raw database row into the canonical user shape.
 */
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
  };
}

/**
 * Create a new user.
 * Returns { id, username, email }.
 * Lets ER_DUP_ENTRY propagate so the caller can handle it.
 */
async function create({ username, email, passwordHash }) {
  const [result] = await pool.execute(
    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    [username, email, passwordHash]
  );
  return { id: result.insertId, username, email };
}

/**
 * Find a user by username.
 * Returns { id, username, email, passwordHash } or null.
 */
async function findByUsername(username) {
  const [rows] = await pool.execute(
    "SELECT * FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  return rowToUser(rows[0] || null);
}

/**
 * Find a user by id.
 * Returns { id, username, email } or null.
 */
async function findById(id) {
  const parsed = parseInt(id, 10);
  if (!parsed || parsed < 1) return null;
  const [rows] = await pool.execute(
    "SELECT user_id, username, email FROM users WHERE user_id = ? LIMIT 1",
    [parsed]
  );
  if (!rows[0]) return null;
  return { id: rows[0].user_id, username: rows[0].username, email: rows[0].email };
}

module.exports = { create, findByUsername, findById };

