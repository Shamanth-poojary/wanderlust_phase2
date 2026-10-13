/**
 * config/dashboardSections.js
 * Extensible Section Registry mapping roles to dashboard sections.
 */

"use strict";

const sections = {
  common: [
    { key: "profile", label: "My Profile", icon: "fa-solid fa-user", path: "/dashboard/profile" },
    { key: "wishlist", label: "Wishlist", icon: "fa-solid fa-heart", path: "/dashboard/wishlist" },
  ],
  customer: [
    { key: "bookings", label: "My Bookings", icon: "fa-solid fa-calendar-check", path: "/dashboard/bookings", enabled: false },
  ],
  owner: [
    { key: "listings", label: "My Listings", icon: "fa-solid fa-list", path: "/dashboard/listings" },
  ],
  admin: [
    { key: "listings", label: "Manage Listings", icon: "fa-solid fa-hotel", path: "/dashboard/listings" },
    { key: "approvals", label: "Owner Approvals", icon: "fa-solid fa-user-check", path: "/dashboard/approvals" },
    { key: "users", label: "Users", icon: "fa-solid fa-users", path: "/dashboard/users" },
  ],
};

/**
 * Returns the combined common and role-specific sections for a given role.
 * @param {string} role 'customer' | 'owner' | 'admin'
 * @returns {Array<object>}
 */
function getSectionsForRole(role) {
  const common = sections.common || [];
  const roleSpecific = sections[role] || [];
  return [...common, ...roleSpecific];
}

module.exports = {
  sections,
  getSectionsForRole,
};
