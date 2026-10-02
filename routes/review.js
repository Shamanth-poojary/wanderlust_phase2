const express = require("express");
const router = express.Router({ mergeParams: true }); //so that we can access :id from parent route
const wrapAsync = require("../utils/wrapAsync");

const validateReview = require("../utils/validateReview");
const { isLoggedIn, isReviewOwner } = require("../middleware");
const ReviewController = require("../controller/reviews.js");
//review section
//post route
router.post(
  "/",
  isLoggedIn,
  validateReview,
  wrapAsync(ReviewController.postReview)
);
//review delete route
router.delete(
  "/:reviewId",
  isLoggedIn,
  isReviewOwner,
  wrapAsync(ReviewController.deleteReview)
);
module.exports = router;
