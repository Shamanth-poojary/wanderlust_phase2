const express = require("express");
const router  = express.Router();

const wrapAsync       = require("../utils/wrapAsync");
const validateListing = require("../utils/validateListing");
const { isLoggedIn, isOwner, isApprovedOwner } = require("../middleware.js");

const listingController = require("../controller/listings.js");

const multer        = require("multer");
const { storage }   = require("../cloudConfig.js");
const upload        = multer({ storage });

// =======================
// INDEX (public)
// =======================
router.get("/", wrapAsync(listingController.index));

// =======================
// NEW FORM
// =======================
router.get("/new", isLoggedIn, isApprovedOwner, listingController.newform);

// =======================
// CREATE
// =======================
router.post(
  "/",
  isLoggedIn,
  isApprovedOwner,
  upload.single("image"),
  validateListing,
  wrapAsync(listingController.postListing)
);

// =======================
// SHOW (public)
// =======================
router.get("/:id", wrapAsync(listingController.showListing));

// =======================
// EDIT FORM
// =======================
router.get(
  "/:id/edit",
  isLoggedIn,
  isApprovedOwner,
  isOwner,
  wrapAsync(listingController.editListing)
);

// =======================
// UPDATE
// =======================
router.put(
  "/:id",
  isLoggedIn,
  isApprovedOwner,
  isOwner,
  upload.single("image"),
  validateListing,
  wrapAsync(listingController.updateListing)
);

// =======================
// DELETE
// =======================
router.delete(
  "/:id",
  isLoggedIn,
  isApprovedOwner,
  isOwner,
  wrapAsync(listingController.deleteListing)
);

module.exports = router;
