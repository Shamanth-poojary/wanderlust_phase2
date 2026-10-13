/**
 * controller/dashboard.js
 * Central controller for all role-based dashboard sections.
 */

"use strict";

const User         = require("../models/user");
const Listing      = require("../models/listing");
const Wishlist     = require("../models/wishlist");
const OwnerProfile = require("../models/ownerProfile");
const { getSectionsForRole } = require("../config/dashboardSections");
const { profileSchema } = require("../schema");
const { deleteCloudinaryAsset } = require("../cloudConfig");
const { BUSINESS_TYPES, OWNER_STATUS_LABELS } = require("../utils/roles");

const MAIN_ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";

/**
 * GET /dashboard
 * Entry point: redirects based on role.
 */
module.exports.index = (req, res) => {
  const role = req.user.role;
  if (role === "admin") {
    return res.redirect("/dashboard/approvals");
  }
  if (role === "owner") {
    return res.redirect("/dashboard/listings");
  }
  // customer
  return res.redirect("/dashboard/wishlist");
};

/**
 * GET /dashboard/profile
 * Displays profile details and edit form.
 */
module.exports.renderProfile = async (req, res) => {
  const user = await User.findById(req.user.id);
  const sections = getSectionsForRole(req.user.role);
  res.render("dashboard/profile.ejs", {
    user,
    sections,
    activeSection: "profile",
  });
};

/**
 * PUT /dashboard/profile
 * Updates editable profile information (username, phone, bio, avatar).
 */
module.exports.updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { error, value } = profileSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const msg = error.details.map((d) => d.message).join(", ");
    req.flash("error", msg);
    return res.redirect("/dashboard/profile");
  }

  const { username, phone, bio, removeAvatar } = value;

  // Check unique username if username changed
  if (username !== req.user.username) {
    const existing = await User.findByUsername(username);
    if (existing && existing.id !== userId) {
      req.flash("error", "That username is already taken. Please choose another.");
      return res.redirect("/dashboard/profile");
    }
  }

  // Handle avatar removal
  if (removeAvatar === "true" || removeAvatar === "1" || removeAvatar === "on") {
    await User.removeProfilePicture(userId);
  }

  // Handle avatar replace/upload
  let profilePictureUrl = null;
  let profilePicturePublicId = null;

  if (req.file) {
    // Delete previous avatar from Cloudinary if replacing
    const currentUser = await User.findById(userId);
    if (currentUser && currentUser.profilePicturePublicId) {
      await deleteCloudinaryAsset(currentUser.profilePicturePublicId);
    }
    profilePictureUrl = req.file.path;
    profilePicturePublicId = req.file.filename;
  }

  await User.updateProfile(userId, {
    username,
    phone,
    bio,
    profilePictureUrl,
    profilePicturePublicId,
  });

  req.flash("success", "Profile updated successfully!");
  res.redirect("/dashboard/profile");
};

/**
 * GET /dashboard/wishlist (Customer)
 */
module.exports.renderWishlist = async (req, res) => {
  const wishlist = await Wishlist.getUserWishlist(req.user.id);
  const sections = getSectionsForRole(req.user.role);
  res.render("dashboard/wishlist.ejs", {
    wishlist,
    sections,
    activeSection: "wishlist",
  });
};

/**
 * GET /dashboard/bookings (Customer placeholder)
 */
module.exports.renderBookings = (req, res) => {
  const sections = getSectionsForRole("customer");
  res.render("dashboard/bookings.ejs", {
    sections,
    activeSection: "bookings",
  });
};

/**
 * GET /dashboard/listings (Owner & Admin)
 */
module.exports.renderListings = async (req, res) => {
  let listings;
  if (req.user.role === "admin") {
    const pool = require("../db/pool");
    const [rows] = await pool.execute(
      `SELECT listing_id, title, description, price, location, country,
              image_url, image_filename, created_at
       FROM listings
       ORDER BY created_at DESC`
    );
    listings = rows.map((r) => ({
      id: r.listing_id,
      title: r.title,
      description: r.description,
      price: r.price,
      location: r.location,
      country: r.country,
      image: { url: r.image_url, filename: r.image_filename },
      createdAt: r.created_at,
    }));
  } else {
    listings = await Listing.findByOwnerId(req.user.id);
  }
  const sections = getSectionsForRole(req.user.role);
  res.render("dashboard/listings.ejs", {
    listings,
    sections,
    activeSection: "listings",
  });
};

/**
 * GET /dashboard/approvals (Admin)
 */
module.exports.renderApprovals = async (req, res) => {
  const VALID_STATUSES = ["pending", "approved", "rejected", "all"];
  const filter = VALID_STATUSES.includes(req.query.status) ? req.query.status : "pending";
  const owners = await OwnerProfile.listByStatus(filter);
  const counts = await OwnerProfile.countsByStatus();
  const sections = getSectionsForRole("admin");

  res.render("dashboard/approvals.ejs", {
    owners,
    filter,
    counts,
    BUSINESS_TYPES,
    OWNER_STATUS_LABELS,
    sections,
    activeSection: "approvals",
  });
};

/**
 * POST /dashboard/approvals/:userId/approve (Admin)
 */
module.exports.approveOwner = async (req, res) => {
  const body = req.body || {};
  const filter = body.filter || req.query.status || "pending";
  const userId = parseInt(req.params.userId, 10);

  if (!userId || userId < 1) {
    req.flash("error", "Owner application not found");
    return res.redirect(`/dashboard/approvals?status=${filter}`);
  }

  const profile = await OwnerProfile.findByUserId(userId);
  const user    = profile ? await User.findById(userId) : null;

  if (!profile || !user || user.role !== "owner") {
    req.flash("error", "Owner application not found");
    return res.redirect(`/dashboard/approvals?status=${filter}`);
  }

  await OwnerProfile.setDecision(userId, "approved", null);
  req.flash("success", `Owner ${user.username} approved.`);
  res.redirect(`/dashboard/approvals?status=${filter}`);
};

/**
 * POST /dashboard/approvals/:userId/reject (Admin)
 */
module.exports.rejectOwner = async (req, res) => {
  const body = req.body || {};
  const filter = body.filter || req.query.status || "pending";
  const userId = parseInt(req.params.userId, 10);

  if (!userId || userId < 1) {
    req.flash("error", "Owner application not found");
    return res.redirect(`/dashboard/approvals?status=${filter}`);
  }

  const profile = await OwnerProfile.findByUserId(userId);
  const user    = profile ? await User.findById(userId) : null;

  if (!profile || !user || user.role !== "owner") {
    req.flash("error", "Owner application not found");
    return res.redirect(`/dashboard/approvals?status=${filter}`);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > 500) {
    req.flash("error", "Rejection reason must be 500 characters or fewer.");
    return res.redirect(`/dashboard/approvals?status=${filter}`);
  }

  await OwnerProfile.setDecision(userId, "rejected", reason || null);
  req.flash("success", `Owner ${user.username} rejected.`);
  res.redirect(`/dashboard/approvals?status=${filter}`);
};

/**
 * GET /dashboard/users (Admin)
 */
module.exports.renderUsers = async (req, res) => {
  const { role = "all", ownerStatus = "all", search = "", sort = "newest", page = 1 } = req.query;

  const result = await User.findAllFiltered({
    role,
    ownerStatus,
    search,
    sort,
    page,
    limit: 10,
  });

  const sections = getSectionsForRole("admin");

  res.render("dashboard/users.ejs", {
    users: result.users,
    totalUsers: result.total,
    totalPages: result.totalPages,
    currentPage: result.currentPage,
    roleFilter: role,
    ownerStatusFilter: ownerStatus,
    search,
    sort,
    mainAdminUsername: MAIN_ADMIN_USERNAME,
    sections,
    activeSection: "users",
  });
};

/**
 * GET /dashboard/users/:id (Admin user details)
 */
module.exports.renderUserDetail = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId || userId < 1) {
    req.flash("error", "User not found.");
    return res.redirect("/dashboard/users");
  }

  const targetUser = await User.findById(userId);
  if (!targetUser) {
    req.flash("error", "User not found.");
    return res.redirect("/dashboard/users");
  }

  let ownerProfile = null;
  let listings = [];
  let wishlistCount = 0;

  if (targetUser.role === "owner") {
    ownerProfile = await OwnerProfile.findByUserId(userId);
    listings = await Listing.findByOwnerId(userId);
  } else if (targetUser.role === "customer") {
    wishlistCount = await Wishlist.countByUserId(userId);
  }

  const sections = getSectionsForRole("admin");

  res.render("dashboard/user-detail.ejs", {
    targetUser,
    ownerProfile,
    listings,
    wishlistCount,
    mainAdminUsername: MAIN_ADMIN_USERNAME,
    sections,
    activeSection: "users",
  });
};

/**
 * DELETE /dashboard/users/:id (Admin delete user)
 */
module.exports.deleteUser = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId || userId < 1) {
    req.flash("error", "Invalid user ID.");
    return res.redirect("/dashboard/users");
  }

  const targetUser = await User.findById(userId);
  if (!targetUser) {
    req.flash("error", "User not found.");
    return res.redirect("/dashboard/users");
  }

  // Self deletion protection
  if (targetUser.id === req.user.id) {
    req.flash("error", "Administrators cannot delete their own account.");
    return res.redirect("/dashboard/users");
  }

  // Main admin protection
  if (targetUser.username === MAIN_ADMIN_USERNAME || (targetUser.role === "admin" && targetUser.id === 1)) {
    req.flash("error", "The primary administrator account cannot be deleted.");
    return res.redirect("/dashboard/users");
  }

  await User.deleteUser(userId);
  req.flash("success", `User ${targetUser.username} and all associated records were successfully removed.`);
  res.redirect("/dashboard/users");
};

/**
 * DELETE /dashboard/users/:userId/listings/:listingId (Admin delete listing)
 */
module.exports.deleteUserListing = async (req, res) => {
  const { userId, listingId } = req.params;
  const lid = parseInt(listingId, 10);

  if (!lid || lid < 1) {
    req.flash("error", "Listing not found.");
    return res.redirect(`/dashboard/users/${userId}`);
  }

  await Listing.deleteWithImage(lid);
  req.flash("success", "Listing successfully removed.");
  res.redirect(`/dashboard/users/${userId}`);
};
