/**
 * routes/dashboard.js
 * Central router for all role-based dashboard pages and actions.
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { isLoggedIn, requireRole } = require("../middleware");
const wrapAsync = require("../utils/wrapAsync");
const dashboardController = require("../controller/dashboard");
const { uploadAvatar } = require("../cloudConfig");

// 1. Dashboard Root (Redirects based on role)
router.get("/", isLoggedIn, dashboardController.index);

// 2. Common: Profile
router.get("/profile", isLoggedIn, wrapAsync(dashboardController.renderProfile));
router.put(
  "/profile",
  isLoggedIn,
  uploadAvatar.single("avatar"),
  wrapAsync(dashboardController.updateProfile)
);
// In case of POST without method-override
router.post(
  "/profile",
  isLoggedIn,
  uploadAvatar.single("avatar"),
  wrapAsync(dashboardController.updateProfile)
);

// 3. Wishlist (all authenticated users) & Bookings (customer)
router.get(
  "/wishlist",
  isLoggedIn,
  wrapAsync(dashboardController.renderWishlist)
);
router.get(
  "/bookings",
  isLoggedIn,
  requireRole("customer"),
  dashboardController.renderBookings
);

// 4. Owner & Admin: Listings
router.get(
  "/listings",
  isLoggedIn,
  requireRole("owner", "admin"),
  wrapAsync(dashboardController.renderListings)
);

// 5. Admin: Owner Approvals
router.get(
  "/approvals",
  isLoggedIn,
  requireRole("admin"),
  wrapAsync(dashboardController.renderApprovals)
);
router.post(
  "/approvals/:userId/approve",
  isLoggedIn,
  requireRole("admin"),
  wrapAsync(dashboardController.approveOwner)
);
router.post(
  "/approvals/:userId/reject",
  isLoggedIn,
  requireRole("admin"),
  wrapAsync(dashboardController.rejectOwner)
);

// 6. Admin: User Management
router.get(
  "/users",
  isLoggedIn,
  requireRole("admin"),
  wrapAsync(dashboardController.renderUsers)
);
router.get(
  "/users/:id",
  isLoggedIn,
  requireRole("admin"),
  wrapAsync(dashboardController.renderUserDetail)
);
router.delete(
  "/users/:id",
  isLoggedIn,
  requireRole("admin"),
  wrapAsync(dashboardController.deleteUser)
);
router.delete(
  "/users/:userId/listings/:listingId",
  isLoggedIn,
  requireRole("admin"),
  wrapAsync(dashboardController.deleteUserListing)
);

module.exports = router;
