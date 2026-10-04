/**
 * controller/admin.js
 * Handles the admin owner-applications management page and approve/reject actions.
 */

"use strict";

const OwnerProfile = require("../models/ownerProfile");
const User         = require("../models/user");
const { BUSINESS_TYPES, OWNER_STATUS_LABELS } = require("../utils/roles");

const VALID_STATUSES = ["pending", "approved", "rejected", "all"];

function sanitizeFilter(raw) {
  return VALID_STATUSES.includes(raw) ? raw : "pending";
}

/**
 * GET /admin/owners
 * Lists owner applications filtered by ?status= (defaults to 'pending').
 */
module.exports.listOwners = async (req, res) => {
  const filter  = sanitizeFilter(req.query.status);
  const owners  = await OwnerProfile.listByStatus(filter);
  const counts  = await OwnerProfile.countsByStatus();
  res.render("admin/owners.ejs", { owners, filter, counts, BUSINESS_TYPES, OWNER_STATUS_LABELS });
};

/**
 * POST /admin/owners/:userId/approve
 * Sets the owner's status to 'approved'.
 */
module.exports.approveOwner = async (req, res) => {
  const body = req.body || {};
  const filter = sanitizeFilter(body.filter || body.status || req.query.status);
  const userId = parseInt(req.params.userId, 10);

  if (!userId || userId < 1) {
    req.flash("error", "Owner application not found");
    return res.redirect(`/admin/owners?status=${filter}`);
  }

  const profile = await OwnerProfile.findByUserId(userId);
  const user    = profile ? await User.findById(userId) : null;

  if (!profile || !user || user.role !== "owner") {
    req.flash("error", "Owner application not found");
    return res.redirect(`/admin/owners?status=${filter}`);
  }

  await OwnerProfile.setDecision(userId, "approved", null);
  req.flash("success", `Owner ${user.username} approved.`);
  res.redirect(`/admin/owners?status=${filter}`);
};

/**
 * POST /admin/owners/:userId/reject
 * Sets the owner's status to 'rejected' with an optional reason.
 */
module.exports.rejectOwner = async (req, res) => {
  const body = req.body || {};
  const filter = sanitizeFilter(body.filter || body.status || req.query.status);
  const userId = parseInt(req.params.userId, 10);

  if (!userId || userId < 1) {
    req.flash("error", "Owner application not found");
    return res.redirect(`/admin/owners?status=${filter}`);
  }

  const profile = await OwnerProfile.findByUserId(userId);
  const user    = profile ? await User.findById(userId) : null;

  if (!profile || !user || user.role !== "owner") {
    req.flash("error", "Owner application not found");
    return res.redirect(`/admin/owners?status=${filter}`);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > 500) {
    req.flash("error", "Rejection reason must be 500 characters or fewer.");
    return res.redirect(`/admin/owners?status=${filter}`);
  }

  await OwnerProfile.setDecision(userId, "rejected", reason || null);
  req.flash("success", `Owner ${user.username} rejected.`);
  res.redirect(`/admin/owners?status=${filter}`);
};
