/**
 * controller/wishlist.js
 * Handles adding and removing listings from a customer's wishlist.
 */

"use strict";

const Wishlist = require("../models/wishlist");
const Listing  = require("../models/listing");

/**
 * POST /wishlist/:listingId
 * Adds listing to wishlist (AJAX/Fetch supported).
 */
module.exports.addWishlist = async (req, res) => {
  const listingId = parseInt(req.params.listingId, 10);
  if (!listingId || listingId < 1) {
    if (req.xhr || req.headers.accept?.includes("json") || req.is("json")) {
      return res.status(400).json({ success: false, message: "Invalid listing ID" });
    }
    req.flash("error", "Listing not found.");
    return res.redirect("/listings");
  }

  const listing = await Listing.findById(listingId);
  if (!listing) {
    if (req.xhr || req.headers.accept?.includes("json") || req.is("json")) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }
    req.flash("error", "Listing not found.");
    return res.redirect("/listings");
  }

  await Wishlist.add(req.user.id, listingId);

  if (req.xhr || req.headers.accept?.includes("json") || req.is("json")) {
    return res.json({ success: true, wishlisted: true, message: "Added to wishlist" });
  }

  req.flash("success", "Added to wishlist!");
  res.redirect(`/listings/${listingId}`);
};

/**
 * DELETE /wishlist/:listingId
 * Removes listing from wishlist. Supports AJAX and regular form submission.
 */
module.exports.removeWishlist = async (req, res) => {
  const listingId = parseInt(req.params.listingId, 10);
  if (!listingId || listingId < 1) {
    if (req.xhr || req.headers.accept?.includes("json") || req.is("json")) {
      return res.status(400).json({ success: false, message: "Invalid listing ID" });
    }
    req.flash("error", "Invalid listing ID.");
    return res.redirect("/dashboard/wishlist");
  }

  await Wishlist.remove(req.user.id, listingId);

  if (req.xhr || req.headers.accept?.includes("json") || req.is("json")) {
    return res.json({ success: true, wishlisted: false, message: "Removed from wishlist" });
  }

  req.flash("success", "Listing removed from wishlist.");
  const redirectTarget = req.headers.referer && req.headers.referer.includes("/dashboard/wishlist")
    ? "/dashboard/wishlist"
    : `/listings/${listingId}`;
  res.redirect(redirectTarget);
};
