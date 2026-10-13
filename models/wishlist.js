/**
 * models/wishlist.js
 * Model managing customer wishlist items in MySQL.
 */

"use strict";

const pool = require("../db/pool");

function parseId(id) {
  const n = parseInt(id, 10);
  return n > 0 ? n : null;
}

/**
 * Add a listing to a user's wishlist.
 * Idempotent (INSERT IGNORE).
 */
async function add(userId, listingId) {
  const uid = parseId(userId);
  const lid = parseId(listingId);
  if (!uid || !lid) return false;

  const [result] = await pool.execute(
    "INSERT IGNORE INTO wishlists (user_id, listing_id) VALUES (?, ?)",
    [uid, lid]
  );
  return result.affectedRows > 0;
}

/**
 * Remove a listing from a user's wishlist.
 */
async function remove(userId, listingId) {
  const uid = parseId(userId);
  const lid = parseId(listingId);
  if (!uid || !lid) return false;

  const [result] = await pool.execute(
    "DELETE FROM wishlists WHERE user_id = ? AND listing_id = ?",
    [uid, lid]
  );
  return result.affectedRows > 0;
}

/**
 * Check if a listing is in a user's wishlist.
 */
async function isWishlisted(userId, listingId) {
  const uid = parseId(userId);
  const lid = parseId(listingId);
  if (!uid || !lid) return false;

  const [rows] = await pool.execute(
    "SELECT id FROM wishlists WHERE user_id = ? AND listing_id = ? LIMIT 1",
    [uid, lid]
  );
  return rows.length > 0;
}

/**
 * Get all listings saved in a user's wishlist.
 */
async function getUserWishlist(userId) {
  const uid = parseId(userId);
  if (!uid) return [];

  const [rows] = await pool.execute(
    `SELECT l.listing_id, l.title, l.description, l.price, l.location, l.country,
            l.image_url, l.image_filename, w.created_at AS wishlisted_at
     FROM wishlists w
     JOIN listings l ON l.listing_id = w.listing_id
     WHERE w.user_id = ?
     ORDER BY w.created_at DESC`,
    [uid]
  );

  return rows.map((r) => ({
    id: r.listing_id,
    title: r.title,
    description: r.description,
    price: r.price,
    location: r.location,
    country: r.country,
    image: { url: r.image_url, filename: r.image_filename },
    wishlistedAt: r.wishlisted_at,
  }));
}

/**
 * Get a set of listing IDs wishlisted by a user.
 */
async function getUserWishlistListingIds(userId) {
  const uid = parseId(userId);
  if (!uid) return new Set();

  const [rows] = await pool.execute(
    "SELECT listing_id FROM wishlists WHERE user_id = ?",
    [uid]
  );
  return new Set(rows.map((r) => r.listing_id));
}

/**
 * Count wishlist items for a user.
 */
async function countByUserId(userId) {
  const uid = parseId(userId);
  if (!uid) return 0;

  const [rows] = await pool.execute(
    "SELECT COUNT(*) AS c FROM wishlists WHERE user_id = ?",
    [uid]
  );
  return rows[0] ? rows[0].c : 0;
}

module.exports = {
  add,
  remove,
  isWishlisted,
  getUserWishlist,
  getUserWishlistListingIds,
  countByUserId,
};
