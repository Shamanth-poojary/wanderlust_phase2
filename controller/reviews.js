const Listing = require("../models/listing");
const Review = require("../models/review");
const ExpressError = require("../utils/ExpressError");

// post review
module.exports.postReview = async (req, res) => {
  const { id } = req.params;

  // Verify listing exists (404 if not)
  const listing = await Listing.findByIdWithDetails(id);
  if (!listing) throw new ExpressError(404, "Listing not found");

  const { rating, comment } = req.body.review;
  await Review.create({ listingId: Number(id), userId: req.user.id, rating, comment });

  req.flash("success", "posted a review!");
  res.redirect(`/listings/${id}`);
};

// delete review
module.exports.deleteReview = async (req, res) => {
  const { id, reviewId } = req.params;
  await Review.remove(reviewId);
  req.flash("success", " review deleted !");
  res.redirect(`/listings/${id}`);
};

