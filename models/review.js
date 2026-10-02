const pool = require("../db/pool");

/**
 * Helper: parse id safely. Returns null for non-positive or non-integer ids.
 */
function parseId(id) {
  const n = parseInt(id, 10);
  return n > 0 ? n : null;
}

/**
 * create – inserts a new review.
 * Returns the new review id (number).
 */
async function create({ listingId, userId, rating, comment }) {
  const [result] = await pool.execute(
    "INSERT INTO reviews (listing_id, user_id, rating, comment) VALUES (?, ?, ?, ?)",
    [listingId, userId, rating, comment]
  );
  return result.insertId;
}

/**
 * findById – returns a review row or null.
 */
async function findById(id) {
  const nid = parseId(id);
  if (!nid) return null;
  const [rows] = await pool.execute(
    "SELECT * FROM reviews WHERE review_id = ? LIMIT 1",
    [nid]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.review_id,
    listingId: r.listing_id,
    userId: r.user_id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
  };
}

/**
 * remove – deletes a review by id.
 * Returns affected rows count.
 */
async function remove(id) {
  const nid = parseId(id);
  if (!nid) return 0;
  const [result] = await pool.execute(
    "DELETE FROM reviews WHERE review_id = ?",
    [nid]
  );
  return result.affectedRows;
}

module.exports = { create, findById, remove };

