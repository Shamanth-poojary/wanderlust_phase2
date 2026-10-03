const bcrypt = require("bcryptjs");
const User = require("../models/user");
const { SELF_REGISTER_ROLES, ROLE_LABELS } = require("../utils/roles");

// signup routes
module.exports.renderSignup = (req, res) => {
  const queryRole = req.query.role;
  // Preselect only if it is a valid self-registration role; otherwise default to customer
  const selectedRole = SELF_REGISTER_ROLES.includes(queryRole) ? queryRole : "customer";
  res.render("users/signup.ejs", { selectedRole });
};

// post signup
module.exports.signupUser = async (req, res, next) => {
  try {
    // req.body has already been validated and sanitised by validateUser middleware
    const { username, email, password, role } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, passwordHash, role });

    req.login(user, (err) => {
      if (err) return next(err);
      req.flash("success", `Welcome to Wanderlust! You are registered as ${ROLE_LABELS[role]}.`);
      res.redirect("/listings");
    });
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
  res.redirect(res.locals.redirectUrl || "/listings");
};

// logout route – redirects to / (landing page)
module.exports.logoutUser = (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    req.flash("success", "Logged out successfully!");
    res.redirect("/");
  });
};
