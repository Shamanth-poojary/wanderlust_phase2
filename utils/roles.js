/**
 * utils/roles.js
 * Single source of truth for role names, labels, business types, and owner status labels.
 */

"use strict";

const ROLES = {
  ADMIN: "admin",
  OWNER: "owner",
  CUSTOMER: "customer",
};

/** Roles a visitor may choose during self-registration. */
const SELF_REGISTER_ROLES = ["customer", "owner"];

/** Human-readable labels shown to users. */
const ROLE_LABELS = {
  customer: "Customer",
  owner: "Property / Venue Owner",
  admin: "Admin",
};

/** Business type enum values to human-readable labels. */
const BUSINESS_TYPES = {
  hotel_owner:    "Hotel Owner",
  property_owner: "Property Owner",
  venue_owner:    "Venue Owner",
  event_planner:  "Event Planner",
};

/** Owner approval status labels shown to users. */
const OWNER_STATUS_LABELS = {
  pending:  "Pending approval",
  approved: "Approved",
  rejected: "Not approved",
  none:     "Application not submitted",
};

module.exports = { ROLES, SELF_REGISTER_ROLES, ROLE_LABELS, BUSINESS_TYPES, OWNER_STATUS_LABELS };
