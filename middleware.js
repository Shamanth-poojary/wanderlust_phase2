const Listing = require("./models/listing");
const Review = require("./models/review");

module.exports.isLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    // tracking the url user is requesting
    req.session.redirectUrl = req.originalUrl;
    req.flash("error", "You must be signed in first!");
    return res.redirect("/login");
  }
  next();
};

module.exports.saveRedirectUrl = (req, res, next) => {
  if (req.session.redirectUrl) {
    res.locals.redirectUrl = req.session.redirectUrl;
    delete req.session.redirectUrl;
  }
  next();
};

module.exports.isOwner = async (req, res, next) => {
  const { id } = req.params;

  // F11: invalid id guard
  const ownerId = await Listing.getOwnerId(id);

  if (ownerId === null) {
    req.flash("error", "Listing not found");
    return res.redirect("/listings");
  }

  if (ownerId !== req.user.id) {
    req.flash("error", "You don't have permission to alter this listing");
    return res.redirect(`/listings/${id}`);
  }

  next();
};

module.exports.isReviewOwner = async (req, res, next) => {
  const { id, reviewId } = req.params;

  const review = await Review.findById(reviewId);

  if (!review) {
    req.flash("error", "Review not found");
    return res.redirect(`/listings/${id}`);
  }

  if (review.userId !== req.user.id) {
    req.flash("error", "You don't have permission to modify this review");
    return res.redirect(`/listings/${id}`);
  }

  next(); // user is the review owner
};

/**
 * Middleware factory that restricts access to specific roles.
 * NOT applied to any route yet – reserved for a future phase.
 *
 * Usage: router.get("/admin", requireRole("admin"), handler)
 */
module.exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.session.redirectUrl = req.originalUrl;
    req.flash("error", "You must be signed in first!");
    return res.redirect("/login");
  }
  if (!roles.includes(req.user.role)) {
    req.flash("error", "You don't have permission to do that.");
    return res.redirect("/listings");
  }
  next();
};
