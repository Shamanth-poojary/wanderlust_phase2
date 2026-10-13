const pool = require("../db/pool");

/**
 * Helper: parse id safely. Returns null for non-positive or non-integer ids.
 */
function parseId(id) {
  const n = parseInt(id, 10);
  return n > 0 ? n : null;
}

/**
 * Map a DB row to the minimal listing shape (index page).
 */
function rowToMinimal(row) {
  if (!row) return null;
  return {
    id: row.listing_id,
    title: row.title,
    price: row.price,
    image: { url: row.image_url, filename: row.image_filename },
  };
}

/**
 * Map a DB row (possibly joined) to the full listing shape without reviews.
 */
function rowToListing(row) {
  if (!row) return null;
  return {
    id: row.listing_id,
    title: row.title,
    description: row.description,
    price: row.price,
    location: row.location,
    country: row.country,
    image: { url: row.image_url, filename: row.image_filename },
    geometry:
      row.latitude != null && row.longitude != null
        ? { coordinates: [row.longitude, row.latitude] }
        : null,
    owner:
      row.owner_id != null
        ? { id: row.owner_id, username: row.owner_username || null }
        : null,
  };
}

/**
 * findAll – used by the index page.
 * Returns array of { id, title, price, image }.
 */
async function findAll() {
  const [rows] = await pool.execute(
    "SELECT listing_id, title, price, image_url, image_filename FROM listings ORDER BY created_at DESC"
  );
  return rows.map(rowToMinimal);
}

/**
 * findByIdWithDetails – used by the show page.
 * Returns the full listing shape including owner and reviews, or null.
 */
async function findByIdWithDetails(id) {
  const nid = parseId(id);
  if (!nid) return null;

  // Fetch listing + owner in one query
  const [listingRows] = await pool.execute(
    `SELECT l.*, u.username AS owner_username
     FROM listings l
     LEFT JOIN users u ON u.user_id = l.owner_id
     WHERE l.listing_id = ?
     LIMIT 1`,
    [nid]
  );
  if (!listingRows[0]) return null;
  const listing = rowToListing(listingRows[0]);

  // Fetch reviews ordered oldest first
  const [reviewRows] = await pool.execute(
    `SELECT r.review_id, r.rating, r.comment, r.created_at,
            u.user_id AS author_id, u.username AS author_username
     FROM reviews r
     JOIN users u ON u.user_id = r.user_id
     WHERE r.listing_id = ?
     ORDER BY r.created_at ASC`,
    [nid]
  );

  listing.reviews = reviewRows.map((r) => ({
    id: r.review_id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
    owner: { id: r.author_id, username: r.author_username },
  }));

  return listing;
}

/**
 * findById – used by edit form (no reviews).
 * Returns listing shape without reviews, or null.
 */
async function findById(id) {
  const nid = parseId(id);
  if (!nid) return null;

  const [rows] = await pool.execute(
    `SELECT l.*, u.username AS owner_username
     FROM listings l
     LEFT JOIN users u ON u.user_id = l.owner_id
     WHERE l.listing_id = ?
     LIMIT 1`,
    [nid]
  );
  return rowToListing(rows[0] || null);
}

/**
 * getOwnerId – returns owner_id (number) or null.
 */
async function getOwnerId(id) {
  const nid = parseId(id);
  if (!nid) return null;
  const [rows] = await pool.execute(
    "SELECT owner_id FROM listings WHERE listing_id = ? LIMIT 1",
    [nid]
  );
  return rows[0] ? rows[0].owner_id : null;
}

/**
 * create – inserts a new listing.
 * Returns the new listing id (number).
 */
async function create({
  ownerId,
  title,
  description,
  price,
  location,
  country,
  imageUrl,
  imageFilename,
  latitude,
  longitude,
}) {
  const [result] = await pool.execute(
    `INSERT INTO listings
       (owner_id, title, description, price, location, country,
        image_url, image_filename, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ownerId,
      title,
      description,
      price,
      location,
      country,
      imageUrl,
      imageFilename || null,
      latitude != null ? latitude : null,
      longitude != null ? longitude : null,
    ]
  );
  return result.insertId;
}

/**
 * update – updates the specified columns of an existing listing.
 * Only updates image columns when imageUrl is provided.
 * Returns affected rows count.
 */
async function update(
  id,
  {
    title,
    description,
    price,
    location,
    country,
    latitude,
    longitude,
    imageUrl,
    imageFilename,
  }
) {
  const nid = parseId(id);
  if (!nid) return 0;

  if (imageUrl) {
    const [result] = await pool.execute(
      `UPDATE listings
       SET title=?, description=?, price=?, location=?, country=?,
           latitude=?, longitude=?, image_url=?, image_filename=?
       WHERE listing_id=?`,
      [
        title,
        description,
        price,
        location,
        country,
        latitude != null ? latitude : null,
        longitude != null ? longitude : null,
        imageUrl,
        imageFilename || null,
        nid,
      ]
    );
    return result.affectedRows;
  } else {
    const [result] = await pool.execute(
      `UPDATE listings
       SET title=?, description=?, price=?, location=?, country=?,
           latitude=?, longitude=?
       WHERE listing_id=?`,
      [
        title,
        description,
        price,
        location,
        country,
        latitude != null ? latitude : null,
        longitude != null ? longitude : null,
        nid,
      ]
    );
    return result.affectedRows;
  }
}

/**
 * findByOwnerId – returns all listings owned by a specific user.
 */
async function findByOwnerId(ownerId) {
  const nid = parseId(ownerId);
  if (!nid) return [];
  const [rows] = await pool.execute(
    `SELECT listing_id, title, description, price, location, country,
            image_url, image_filename, created_at
     FROM listings
     WHERE owner_id = ?
     ORDER BY created_at DESC`,
    [nid]
  );
  return rows.map((r) => ({
    id: r.listing_id,
    title: r.title,
    description: r.description,
    price: r.price,
    location: r.location,
    country: r.country,
    image: { url: r.image_url, filename: r.image_filename },
    createdAt: r.created_at,
  }));
}

/**
 * remove – deletes a listing (cascades to reviews).
 * Returns affected rows count.
 */
async function remove(id) {
  const nid = parseId(id);
  if (!nid) return 0;
  const [result] = await pool.execute(
    "DELETE FROM listings WHERE listing_id = ?",
    [nid]
  );
  return result.affectedRows;
}

/**
 * deleteWithImage – cleans up Cloudinary image and removes listing.
 */
async function deleteWithImage(id) {
  const nid = parseId(id);
  if (!nid) return 0;
  const [rows] = await pool.execute(
    "SELECT image_filename FROM listings WHERE listing_id = ? LIMIT 1",
    [nid]
  );
  if (rows[0] && rows[0].image_filename) {
    const { deleteCloudinaryAsset } = require("../cloudConfig");
    await deleteCloudinaryAsset(rows[0].image_filename);
  }
  return await remove(nid);
}

module.exports = {
  findAll,
  findByIdWithDetails,
  findById,
  findByOwnerId,
  getOwnerId,
  create,
  update,
  remove,
  deleteWithImage,
};

