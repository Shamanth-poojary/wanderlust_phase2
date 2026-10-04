/**
 * utils/permissions.js
 * Single place that defines permission helpers.
 * All routes and views must use these functions instead of
 * duplicating the logic inline.
 */

"use strict";

/**
 * Returns true when the user is an owner with status 'approved'.
 * Works with the shape returned by User.findById:
 *   { id, username, email, role, ownerStatus }
 */
module.exports.isApprovedOwner = (user) =>
  !!user && user.role === "owner" && user.ownerStatus === "approved";
