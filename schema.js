const Joi = require("joi");

const listingSchema = Joi.object({
  title: Joi.string().trim().min(1).required().messages({
    "string.empty": "Title is required.",
  }),
  description: Joi.string().trim().min(1).required().messages({
    "string.empty": "Description is required.",
  }),
  image: Joi.string()
    .uri()
    .allow("")
    .messages({ "string.uri": "Image must be a valid URL." }),
  price: Joi.number().min(0).required().messages({
    "number.base": "Price must be a number.",
    "number.min": "Price cannot be negative.",
    "any.required": "Price is required.",
  }),
  location: Joi.string()
    .trim()
    .required()
    .messages({ "string.empty": "Location is required." }),
  country: Joi.string()
    .trim()
    .required()
    .messages({ "string.empty": "Country is required." }),
});
const profileSchema = Joi.object({
  username: Joi.string().trim().min(3).max(50).required().messages({
    "string.empty": "Username is required.",
    "string.min": "Username must be at least 3 characters.",
    "string.max": "Username cannot exceed 50 characters.",
  }),
  phone: Joi.string().trim().allow("").pattern(/^\+?[0-9]{7,15}$/).max(20).messages({
    "string.pattern.base": "Please provide a valid phone number.",
  }),
  bio: Joi.string().trim().allow("").max(300).messages({
    "string.max": "Bio cannot exceed 300 characters.",
  }),
  removeAvatar: Joi.string().allow("on", "true", "1", "").optional(),
});

module.exports = {
  listingSchema,
  reviewSchema: module.exports.reviewSchema,
  profileSchema,
};
