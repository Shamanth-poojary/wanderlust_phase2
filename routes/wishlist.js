/**
 * routes/wishlist.js
 * Wishlist routes for logged-in customers.
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { isLoggedIn } = require("../middleware");
const wrapAsync = require("../utils/wrapAsync");
const wishlistController = require("../controller/wishlist");

router.post(
  "/:listingId",
  isLoggedIn,
  wrapAsync(wishlistController.addWishlist)
);

router.delete(
  "/:listingId",
  isLoggedIn,
  wrapAsync(wishlistController.removeWishlist)
);

module.exports = router;
