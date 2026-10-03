const pool = require("../db/pool");

/**
 * Parse a raw database row into the canonical user shape.
 * Now includes role.
 */
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
  };
}

/**
 * Create a new user.
 * Returns { id, username, email, role }.
 * Lets ER_DUP_ENTRY propagate so the caller can handle it.
 */
async function create({ username, email, passwordHash, role = "customer" }) {
  const [result] = await pool.execute(
    "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [username, email, passwordHash, role]
  );
  return { id: result.insertId, username, email, role };
}

/**
 * Find a user by username.
 * Returns { id, username, email, passwordHash, role } or null.
 */
async function findByUsername(username) {
  const [rows] = await pool.execute(
    "SELECT user_id, username, email, password_hash, role FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  return rowToUser(rows[0] || null);
}

/**
 * Find a user by id.
 * Returns { id, username, email, role } or null.
 */
async function findById(id) {
  const parsed = parseInt(id, 10);
  if (!parsed || parsed < 1) return null;
  const [rows] = await pool.execute(
    "SELECT user_id, username, email, role FROM users WHERE user_id = ? LIMIT 1",
    [parsed]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].user_id,
    username: rows[0].username,
    email: rows[0].email,
    role: rows[0].role,
  };
}

module.exports = { create, findByUsername, findById };
