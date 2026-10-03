/**
 * db/ensureAdmin.js
 * Creates or synchronises the single admin account.
 *
 * Export: async function ensureAdmin(db = pool)
 *   db may be a mysql2 pool or a single connection; both expose .query().
 *   Returns one of: "created", "updated", "unchanged", "skipped"
 */

"use strict";

const bcrypt = require("bcryptjs");
const pool = require("./pool");

/**
 * Basic email shape check (RFC-5322 simplified).
 * Returns true if the string looks like user@domain.tld.
 */
function looksLikeEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

async function ensureAdmin(db = pool) {
  const username = process.env.ADMIN_USERNAME;
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  // None set: warn and skip gracefully
  if (!username && !email && !password) {
    console.warn("No admin account configured; set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD");
    return "skipped";
  }

  // Partial set or invalid values: throw with a descriptive message
  if (!username) throw new Error("Admin config error: ADMIN_USERNAME is missing.");
  if (!email)    throw new Error("Admin config error: ADMIN_EMAIL is missing.");
  if (!password) throw new Error("Admin config error: ADMIN_PASSWORD is missing.");
  if (password.length < 8) throw new Error("Admin config error: ADMIN_PASSWORD must be at least 8 characters.");
  if (!looksLikeEmail(email)) throw new Error("Admin config error: ADMIN_EMAIL does not look like a valid email address.");

  // Look for an existing admin row
  const [admins] = await db.query(
    "SELECT user_id, username, email, password_hash FROM users WHERE role = 'admin' LIMIT 1"
  );

  if (admins.length === 0) {
    // No admin exists: make sure no non-admin already owns that username or email
    const [conflicts] = await db.query(
      "SELECT user_id FROM users WHERE (username = ? OR email = ?) AND role != 'admin' LIMIT 1",
      [username, email]
    );
    if (conflicts.length > 0) {
      throw new Error(
        "ADMIN_USERNAME or ADMIN_EMAIL is already used by a non-admin account; choose different admin credentials"
      );
    }

    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
      [username, email, hash]
    );
    console.log("Admin account created.");
    return "created";
  }

  // Admin row already exists
  const existing = admins[0];
  let changed = false;

  // Credential update: username or email differs
  if (existing.username !== username || existing.email !== email) {
    // Guard: another non-admin user must not hold the new username/email
    const [conflicts] = await db.query(
      "SELECT user_id FROM users WHERE (username = ? OR email = ?) AND user_id != ? LIMIT 1",
      [username, email, existing.user_id]
    );
    if (conflicts.length > 0) {
      throw new Error(
        "ADMIN_USERNAME or ADMIN_EMAIL is already used by a non-admin account; choose different admin credentials"
      );
    }
    await db.query(
      "UPDATE users SET username = ?, email = ? WHERE user_id = ?",
      [username, email, existing.user_id]
    );
    changed = true;
  }

  // Password update: only rewrite when the stored hash no longer matches
  const passwordMatches = await bcrypt.compare(password, existing.password_hash);
  if (!passwordMatches) {
    const newHash = await bcrypt.hash(password, 10);
    await db.query(
      "UPDATE users SET password_hash = ? WHERE user_id = ?",
      [newHash, existing.user_id]
    );
    changed = true;
  }

  if (changed) {
    console.log("Admin account updated.");
    return "updated";
  }

  console.log("Admin account unchanged.");
  return "unchanged";
}

module.exports = { ensureAdmin };
