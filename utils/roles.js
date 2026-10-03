/**
 * utils/roles.js
 * Single source of truth for role names and labels.
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

module.exports = { ROLES, SELF_REGISTER_ROLES, ROLE_LABELS };
