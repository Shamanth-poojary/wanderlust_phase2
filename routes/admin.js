/**
 * routes/admin.js
 * Admin-facing routes: owner applications management.
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { requireRole } = require("../middleware");
const wrapAsync       = require("../utils/wrapAsync");
const adminController = require("../controller/admin");

// GET /admin/owners
router.get(
  "/owners",
  requireRole("admin"),
  wrapAsync(adminController.listOwners)
);

// POST /admin/owners/:userId/approve
router.post(
  "/owners/:userId/approve",
  requireRole("admin"),
  wrapAsync(adminController.approveOwner)
);

// POST /admin/owners/:userId/reject
router.post(
  "/owners/:userId/reject",
  requireRole("admin"),
  wrapAsync(adminController.rejectOwner)
);

module.exports = router;
