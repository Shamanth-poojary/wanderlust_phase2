/**
 * utils/validateUser.js
 * Joi validation middleware for the signup form and the owner application form.
 */

"use strict";

const Joi = require("joi");
const { SELF_REGISTER_ROLES, BUSINESS_TYPES } = require("./roles");

const VALID_BUSINESS_TYPES = Object.keys(BUSINESS_TYPES);

// Owner-specific fields required when role is 'owner'
const ownerFields = {
  business_name: Joi.string().trim().min(2).max(100).required(),
  business_type: Joi.string().valid(...VALID_BUSINESS_TYPES).required(),
  phone:         Joi.string().trim().pattern(/^\+?[0-9]{10,15}$/).required(),
};

// Stripped fields for non-owner registrations
const strippedOwnerFields = {
  business_name: Joi.any().strip(),
  business_type: Joi.any().strip(),
  phone:         Joi.any().strip(),
};

const signupSchema = Joi.object({
  username: Joi.string().trim().min(3).max(50).required(),
  email:    Joi.string().trim().email().max(255).required(),
  password: Joi.string().min(8).max(72).required(),
  role:     Joi.string().valid(...SELF_REGISTER_ROLES).default("customer"),
}).when(
  Joi.object({ role: Joi.string().valid("owner").required() }).unknown(),
  {
    then:      Joi.object(ownerFields),
    otherwise: Joi.object(strippedOwnerFields),
  }
);

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

/**
 * Joi schema and middleware for the owner application form
 * (POST /owner/application).
 */
const ownerApplicationSchema = Joi.object({
  business_name: Joi.string().trim().min(2).max(100).required(),
  business_type: Joi.string().valid(...VALID_BUSINESS_TYPES).required(),
  phone:         Joi.string().trim().pattern(/^\+?[0-9]{10,15}$/).required(),
});

module.exports.validateOwnerApplication = (req, res, next) => {
  const { error, value } = ownerApplicationSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const msg = error.details.map((d) => d.message).join(", ");
    req.flash("error", msg);
    return res.redirect("/owner/status");
  }

  req.body = value;
  next();
};
