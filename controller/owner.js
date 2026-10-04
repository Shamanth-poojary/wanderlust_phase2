/**
 * controller/owner.js
 * Handles the owner status page and application form.
 */

"use strict";

const OwnerProfile = require("../models/ownerProfile");
const { BUSINESS_TYPES, OWNER_STATUS_LABELS } = require("../utils/roles");

/**
 * GET /owner/status
 * Shows the owner their application status and, where appropriate,
 * the form to submit or re-submit business details.
 */
module.exports.renderStatus = async (req, res) => {
  const profile = await OwnerProfile.findByUserId(req.user.id);
  const status  = profile ? profile.status : "none";
  res.render("owner/status.ejs", { profile, status, BUSINESS_TYPES, OWNER_STATUS_LABELS });
};

/**
 * POST /owner/application
 * Creates a new pending profile (status none) or re-applies (status rejected).
 * Pending and approved owners get an info flash and no change.
 */
module.exports.submitApplication = async (req, res) => {
  const body = req.body || {};
  const { business_name, business_type, phone } = body;
  const profile = await OwnerProfile.findByUserId(req.user.id);
  const status  = profile ? profile.status : "none";

  if (status === "pending" || status === "approved") {
    req.flash("info", `Your application is already ${status}.`);
    return res.redirect("/owner/status");
  }

  if (status === "none") {
    await OwnerProfile.create(
      req.user.id,
      { businessName: business_name, businessType: business_type, phone }
    );
  } else {
    // rejected: re-apply
    await OwnerProfile.reapply(
      req.user.id,
      { businessName: business_name, businessType: business_type, phone }
    );
  }

  req.flash("success", "Your application has been sent to the admin for approval.");
  res.redirect("/owner/status");
};
