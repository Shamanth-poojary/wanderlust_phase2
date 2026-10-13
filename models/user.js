const pool = require("../db/pool");
const { deleteCloudinaryAsset } = require("../cloudConfig");

/**
 * Parse a raw database row into the canonical user shape.
 * Includes role, ownerStatus, avatar, phone, bio, and createdAt.
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
    profilePictureUrl: row.profile_picture_url || null,
    profilePicturePublicId: row.profile_picture_public_id || null,
    phone: row.phone || null,
    bio: row.bio || null,
    createdAt: row.created_at,
    listingCount: typeof row.listing_count !== "undefined" ? Number(row.listing_count) : undefined,
  };
}

/**
 * Create a new user.
 * Returns { id, username, email, role }.
 * Lets ER_DUP_ENTRY propagate so the caller can handle it.
 * Accepts an optional db argument (pool or single connection) for transactions.
 */
async function create(
  {
    username,
    email,
    passwordHash,
    role = "customer",
    profilePictureUrl = null,
    profilePicturePublicId = null,
    phone = null,
    bio = null,
  },
  db = pool
) {
  const [result] = await db.execute(
    `INSERT INTO users
       (username, email, password_hash, role, profile_picture_url, profile_picture_public_id, phone, bio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      username,
      email,
      passwordHash,
      role,
      profilePictureUrl,
      profilePicturePublicId,
      phone,
      bio,
    ]
  );
  return { id: result.insertId, username, email, role };
}

/**
 * Find a user by username.
 */
async function findByUsername(username) {
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.email, u.password_hash, u.role,
            u.profile_picture_url, u.profile_picture_public_id, u.phone, u.bio, u.created_at,
            op.verification_status AS owner_status
     FROM users u
     LEFT JOIN owner_profile op ON op.owner_id = u.user_id
     WHERE u.username = ? LIMIT 1`,
    [username]
  );
  return rowToUser(rows[0] || null);
}

/**
 * Find a user by email.
 */
async function findByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.email, u.password_hash, u.role,
            u.profile_picture_url, u.profile_picture_public_id, u.phone, u.bio, u.created_at,
            op.verification_status AS owner_status
     FROM users u
     LEFT JOIN owner_profile op ON op.owner_id = u.user_id
     WHERE u.email = ? LIMIT 1`,
    [email]
  );
  return rowToUser(rows[0] || null);
}

/**
 * Find a user by id.
 */
async function findById(id) {
  const parsed = parseInt(id, 10);
  if (!parsed || parsed < 1) return null;
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.email, u.role,
            u.profile_picture_url, u.profile_picture_public_id, u.phone, u.bio, u.created_at,
            op.verification_status AS owner_status
     FROM users u
     LEFT JOIN owner_profile op ON op.owner_id = u.user_id
     WHERE u.user_id = ? LIMIT 1`,
    [parsed]
  );
  return rowToUser(rows[0] || null);
}

/**
 * Update user profile details.
 * Editable: username, phone, bio, and optionally profile picture.
 */
async function updateProfile(id, { username, phone, bio, profilePictureUrl, profilePicturePublicId }) {
  const parsed = parseInt(id, 10);
  if (!parsed || parsed < 1) return 0;

  // If a new picture is provided, update picture fields as well
  if (profilePictureUrl) {
    const [result] = await pool.execute(
      `UPDATE users
       SET username = ?, phone = ?, bio = ?,
           profile_picture_url = ?, profile_picture_public_id = ?
       WHERE user_id = ?`,
      [username, phone || null, bio || null, profilePictureUrl, profilePicturePublicId, parsed]
    );
    return result.affectedRows;
  } else {
    const [result] = await pool.execute(
      `UPDATE users
       SET username = ?, phone = ?, bio = ?
       WHERE user_id = ?`,
      [username, phone || null, bio || null, parsed]
    );
    return result.affectedRows;
  }
}

/**
 * Remove user profile picture (both Cloudinary asset and DB columns).
 */
async function removeProfilePicture(id) {
  const parsed = parseInt(id, 10);
  if (!parsed || parsed < 1) return;

  const [rows] = await pool.execute(
    "SELECT profile_picture_public_id FROM users WHERE user_id = ? LIMIT 1",
    [parsed]
  );
  if (rows[0] && rows[0].profile_picture_public_id) {
    await deleteCloudinaryAsset(rows[0].profile_picture_public_id);
  }

  await pool.execute(
    `UPDATE users
     SET profile_picture_url = NULL, profile_picture_public_id = NULL
     WHERE user_id = ?`,
    [parsed]
  );
}

/**
 * List all users with filtering, searching, sorting, and pagination (admin management).
 */
async function findAllFiltered({
  role = "all",
  ownerStatus = "all",
  search = "",
  sort = "newest",
  page = 1,
  limit = 10,
} = {}) {
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const safePage  = Math.max(1, parseInt(page, 10) || 1);
  const offset    = (safePage - 1) * safeLimit;

  const whereClauses = [];
  const params = [];

  if (role && role !== "all") {
    whereClauses.push("u.role = ?");
    params.push(role);
  }

  if (ownerStatus && ownerStatus !== "all") {
    whereClauses.push("op.verification_status = ?");
    params.push(ownerStatus);
  }

  if (search && search.trim()) {
    whereClauses.push("(u.username LIKE ? OR u.email LIKE ?)");
    const searchTerm = `%${search.trim()}%`;
    params.push(searchTerm, searchTerm);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const orderSql = sort === "oldest" ? "ORDER BY u.created_at ASC" : "ORDER BY u.created_at DESC";

  // Count total matching users
  const countQuery = `
    SELECT COUNT(DISTINCT u.user_id) AS total
    FROM users u
    LEFT JOIN owner_profile op ON op.owner_id = u.user_id
    ${whereSql}
  `;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0] ? countRows[0].total : 0;
  const totalPages = Math.ceil(total / safeLimit) || 1;

  // Fetch paginated rows with listing count
  const dataQuery = `
    SELECT u.user_id, u.username, u.email, u.role,
           u.profile_picture_url, u.profile_picture_public_id, u.phone, u.bio, u.created_at,
           op.verification_status AS owner_status,
           COUNT(DISTINCT l.listing_id) AS listing_count
    FROM users u
    LEFT JOIN owner_profile op ON op.owner_id = u.user_id
    LEFT JOIN listings l ON l.owner_id = u.user_id
    ${whereSql}
    GROUP BY u.user_id
    ${orderSql}
    LIMIT ${safeLimit} OFFSET ${offset}
  `;
  const [rows] = await pool.execute(dataQuery, params);

  return {
    users: rows.map(rowToUser),
    total,
    totalPages,
    currentPage: safePage,
    limit: safeLimit,
  };
}

/**
 * Delete a user along with Cloudinary assets and cascaded rows.
 */
async function deleteUser(id) {
  const parsed = parseInt(id, 10);
  if (!parsed || parsed < 1) return 0;

  // 1. Fetch user avatar
  const [userRows] = await pool.execute(
    "SELECT profile_picture_public_id FROM users WHERE user_id = ? LIMIT 1",
    [parsed]
  );
  if (userRows[0] && userRows[0].profile_picture_public_id) {
    await deleteCloudinaryAsset(userRows[0].profile_picture_public_id);
  }

  // 2. Fetch all listings owned by user to delete Cloudinary images
  const [listingRows] = await pool.execute(
    "SELECT image_filename FROM listings WHERE owner_id = ?",
    [parsed]
  );
  for (const listing of listingRows) {
    if (listing.image_filename) {
      await deleteCloudinaryAsset(listing.image_filename);
    }
  }

  // 3. Delete listings owned by user (to satisfy FK RESTRICT)
  await pool.execute("DELETE FROM listings WHERE owner_id = ?", [parsed]);

  // 4. Delete user (cascades to owner_profile, reviews, wishlists)
  const [result] = await pool.execute("DELETE FROM users WHERE user_id = ?", [parsed]);
  return result.affectedRows;
}

module.exports = {
  create,
  findByUsername,
  findByEmail,
  findById,
  updateProfile,
  removeProfilePicture,
  findAllFiltered,
  deleteUser,
};

