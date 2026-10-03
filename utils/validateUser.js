/**
 * utils/validateUser.js
 * Joi validation middleware for the signup form.
 */

"use strict";

const Joi = require("joi");
const { SELF_REGISTER_ROLES } = require("./roles");

const signupSchema = Joi.object({
  username: Joi.string().trim().min(3).max(50).required(),
  email: Joi.string().trim().email().max(255).required(),
  password: Joi.string().min(8).max(72).required(),
  role: Joi.string().valid(...SELF_REGISTER_ROLES).default("customer"),
});

module.exports.validateUser = (req, res, next) => {
  const { error, value } = signupSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const submittedRole = typeof req.body.role === "string" ? req.body.role : "";
    const keep = SELF_REGISTER_ROLES.includes(submittedRole) ? `?role=${submittedRole}` : "";
    const msg = error.details.some((d) => d.path[0] === "role")
      ? "Please choose a valid account type."
      : error.details.map((d) => d.message).join(", ");
    req.flash("error", msg);
    return res.redirect(`/signup${keep}`);
  }

  req.body = value; // only validated fields continue
  next();
};
