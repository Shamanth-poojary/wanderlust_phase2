/**
 * models/ownerProfile.js
 * Data-access functions for the owner_profile table.
 */

"use strict";

const pool = require("../db/pool");

/**
 * Parse a raw database row into the canonical owner profile shape.
 */
function rowToProfile(row) {
  if (!row) return null;
  return {
    userId:          row.owner_id,
    businessName:    row.business_name,
    businessType:    row.business_type,
    phone:           row.phone,
    status:          row.verification_status,
    rejectionReason: row.rejection_reason || null,
    verifiedAt:      row.verified_at || null,
    createdAt:       row.created_at,
    // joined from users table (present in listByStatus)
    username:        row.username || undefined,
    email:           row.email    || undefined,
  };
}

/**
 * Insert a new pending profile for an owner.
 * Accepts an optional db argument for transaction use.
 */
async function create(userId, { businessName, businessType, phone }, db = pool) {
  const id = parseInt(userId, 10);
  if (!id || id < 1) return null;
  await db.execute(
    `INSERT INTO owner_profile
       (owner_id, business_name, business_type, phone, verification_status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [id, businessName, businessType, phone || null]
  );
}

/**
 * Find a profile by owner user_id.
 * Returns the profile object or null.
 */
async function findByUserId(userId) {
  const id = parseInt(userId, 10);
  if (!id || id < 1) return null;
  const [rows] = await pool.execute(
    `SELECT * FROM owner_profile WHERE owner_id = ? LIMIT 1`,
    [id]
  );
  return rowToProfile(rows[0] || null);
}

/**
 * Update profile details and reset status to 'pending'.
 * Only proceeds when the current status is 'rejected'.
 * Returns the number of affected rows (0 if not rejected or not found).
 */
async function reapply(userId, { businessName, businessType, phone }) {
  const id = parseInt(userId, 10);
  if (!id || id < 1) return 0;
  const [result] = await pool.execute(
    `UPDATE owner_profile
     SET business_name = ?, business_type = ?, phone = ?,
         verification_status = 'pending', rejection_reason = NULL, verified_at = NULL
     WHERE owner_id = ? AND verification_status = 'rejected'`,
    [businessName, businessType, phone || null, id]
  );
  return result.affectedRows;
}

/**
 * Set the admin's approval decision.
 * status must be 'approved' or 'rejected'.
 * reason is stored (trimmed) for rejections; ignored (set NULL) for approvals.
 * verified_at is set to NOW() on approval, NULL on rejection.
 * Returns the number of affected rows.
 */
async function setDecision(userId, status, reason) {
  const id = parseInt(userId, 10);
  if (!id || id < 1) return 0;
  const trimmedReason = typeof reason === "string" && reason.trim() ? reason.trim() : null;
  if (status === "approved") {
    const [result] = await pool.execute(
      `UPDATE owner_profile
       SET verification_status = 'approved', verified_at = NOW(), rejection_reason = NULL
       WHERE owner_id = ?`,
      [id]
    );
    return result.affectedRows;
  }
  // rejected
  const [result] = await pool.execute(
    `UPDATE owner_profile
     SET verification_status = 'rejected', verified_at = NULL, rejection_reason = ?
     WHERE owner_id = ?`,
    [trimmedReason, id]
  );
  return result.affectedRows;
}

/**
 * List profiles joined with user data.
 * status: 'pending', 'approved', 'rejected', or 'all'.
 * Returns newest application first.
 */
async function listByStatus(status) {
  const allowed = ["pending", "approved", "rejected"];
  let sql = `
    SELECT op.*, u.username, u.email
    FROM owner_profile op
    JOIN users u ON u.user_id = op.owner_id
  `;
  const params = [];
  if (allowed.includes(status)) {
    sql += " WHERE op.verification_status = ?";
    params.push(status);
  }
  sql += " ORDER BY op.created_at DESC";
  const [rows] = await pool.execute(sql, params);
  return rows.map(rowToProfile);
}

/**
 * Count profiles by status.
 * Returns { pending, approved, rejected, all }.
 */
async function countsByStatus() {
  const [rows] = await pool.execute(
    `SELECT
       SUM(verification_status = 'pending')  AS pending,
       SUM(verification_status = 'approved') AS approved,
       SUM(verification_status = 'rejected') AS rejected,
       COUNT(*)                              AS all_count
     FROM owner_profile`
  );
  const r = rows[0];
  return {
    pending:  Number(r.pending)  || 0,
    approved: Number(r.approved) || 0,
    rejected: Number(r.rejected) || 0,
    all:      Number(r.all_count) || 0,
  };
}

module.exports = { create, findByUserId, reapply, setDecision, listByStatus, countsByStatus };
