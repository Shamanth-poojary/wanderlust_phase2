const pool = require("../db/pool");

/**
 * Parse a raw database row into the canonical user shape.
 * Includes role and ownerStatus (from owner_profile, or null).
 */
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    ownerStatus: row.owner_status || null,
  };
}

/**
 * Create a new user.
 * Returns { id, username, email, role }.
 * Lets ER_DUP_ENTRY propagate so the caller can handle it.
 * Accepts an optional db argument (pool or single connection) for transactions.
 */
async function create({ username, email, passwordHash, role = "customer" }, db = pool) {
  const [result] = await db.execute(
    "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [username, email, passwordHash, role]
  );
  return { id: result.insertId, username, email, role };
}

/**
 * Find a user by username.
 * Returns { id, username, email, passwordHash, role, ownerStatus } or null.
 */
async function findByUsername(username) {
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.email, u.password_hash, u.role,
            op.verification_status AS owner_status
     FROM users u
     LEFT JOIN owner_profile op ON op.owner_id = u.user_id
     WHERE u.username = ? LIMIT 1`,
    [username]
  );
  return rowToUser(rows[0] || null);
}

/**
 * Find a user by id.
 * Returns { id, username, email, role, ownerStatus } or null.
 * ownerStatus is 'pending', 'approved', 'rejected', or null.
 */
async function findById(id) {
  const parsed = parseInt(id, 10);
  if (!parsed || parsed < 1) return null;
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.email, u.role,
            op.verification_status AS owner_status
     FROM users u
     LEFT JOIN owner_profile op ON op.owner_id = u.user_id
     WHERE u.user_id = ? LIMIT 1`,
    [parsed]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].user_id,
    username: rows[0].username,
    email: rows[0].email,
    role: rows[0].role,
    ownerStatus: rows[0].owner_status || null,
  };
}

module.exports = { create, findByUsername, findById };
