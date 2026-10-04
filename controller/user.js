const bcrypt = require("bcryptjs");
const pool   = require("../db/pool");
const User   = require("../models/user");
const OwnerProfile = require("../models/ownerProfile");
const { SELF_REGISTER_ROLES, ROLE_LABELS, BUSINESS_TYPES } = require("../utils/roles");

// signup routes
module.exports.renderSignup = (req, res) => {
  const queryRole = req.query.role;
  // Preselect only if it is a valid self-registration role; otherwise default to customer
  const selectedRole = SELF_REGISTER_ROLES.includes(queryRole) ? queryRole : "customer";
  res.render("users/signup.ejs", { selectedRole, BUSINESS_TYPES });
};

// post signup
module.exports.signupUser = async (req, res, next) => {
  // req.body has already been validated and sanitised by validateUser middleware
  const { username, email, password, role, business_name, business_type, phone } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    if (role === "owner") {
      // Owner: run user insert + profile insert in a single transaction
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const user = await User.create({ username, email, passwordHash, role: "owner" }, conn);
        await OwnerProfile.create(user.id, { businessName: business_name, businessType: business_type, phone }, conn);
        await conn.commit();
        // Log the owner in
        req.login({ id: user.id, username, email, role: "owner", ownerStatus: "pending" }, (err) => {
          if (err) return next(err);
          req.flash("success", "Account created. Your owner application has been sent to the admin for approval.");
          res.redirect("/owner/status");
        });
      } catch (e) {
        await conn.rollback();
        throw e; // ER_DUP_ENTRY handled below
      } finally {
        conn.release();
      }
    } else {
      // Customer: simple insert
      const user = await User.create({ username, email, passwordHash, role });
      req.login({ id: user.id, username, email, role, ownerStatus: null }, (err) => {
        if (err) return next(err);
        req.flash("success", `Welcome to Wanderlust! You are registered as ${ROLE_LABELS[role]}.`);
        res.redirect("/listings");
      });
    }
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      req.flash("error", "A user with that username or email already exists.");
      return res.redirect("/signup");
    }
    return next(e);
  }
};

// login routes
module.exports.renderLogin = (req, res) => {
  res.render("users/login.ejs");
};

module.exports.loginUser = async (req, res) => {
  req.flash("success", "Welcome back!");
  // Priority: previously requested URL > role-based default
  if (res.locals.redirectUrl) {
    return res.redirect(res.locals.redirectUrl);
  }
  const user = req.user;
  if (user.role === "admin") {
    return res.redirect("/admin/owners");
  }
  if (user.role === "owner" && user.ownerStatus !== "approved") {
    return res.redirect("/owner/status");
  }
  res.redirect("/listings");
};

// logout route - redirects to / (landing page)
module.exports.logoutUser = (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    req.flash("success", "Logged out successfully!");
    res.redirect("/");
  });
};
