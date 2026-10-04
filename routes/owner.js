/**
 * routes/owner.js
 * Owner-facing routes: status page and application form.
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { requireRole }            = require("../middleware");
const { validateOwnerApplication } = require("../utils/validateUser");
const wrapAsync                  = require("../utils/wrapAsync");
const ownerController            = require("../controller/owner");

// GET /owner/status
router.get(
  "/status",
  requireRole("owner"),
  wrapAsync(ownerController.renderStatus)
);

// POST /owner/application
router.post(
  "/application",
  requireRole("owner"),
  validateOwnerApplication,
  wrapAsync(ownerController.submitApplication)
);

module.exports = router;
