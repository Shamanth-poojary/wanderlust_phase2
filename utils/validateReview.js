const Joi = require("joi");

const reviewSchema = Joi.object({
  rating: Joi.number().min(1).max(5).required().messages({
    "number.base": "Rating must be a number.",
    "number.min": "Rating must be at least 1.",
    "number.max": "Rating cannot be more than 5.",
    "any.required": "Rating is required.",
  }),
  comment: Joi.string().trim().min(1).required().messages({
    "string.empty": "Comment is required.",
  }),
});

module.exports = function validateReview(req, res, next) {
  // Accept nested `review` form object or top-level body for API
  const payload = req.body.review || req.body;
  const { error, value } = reviewSchema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const errors = {};
    for (const detail of error.details) {
      const key = detail.path[0] || "form";
      if (!errors[key]) errors[key] = detail.message;
    }
    if (
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes("application/json"))
    ) {
      return res.status(400).json({ errors });
    }
    // F6: Use findByIdWithDetails so reviews + owner are populated
    const listingId = req.params.id;
    return require("../models/listing")
      .findByIdWithDetails(listingId)
      .then((listing) => {
        return res
          .status(400)
          .render("listings/show.ejs", { listing, errors, review: payload });
      })
      .catch(next);
  }
  // normalize into req.body.review
  req.body.review = value;
  next();
};

