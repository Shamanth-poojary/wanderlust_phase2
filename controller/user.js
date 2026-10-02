const bcrypt = require("bcryptjs");
const User = require("../models/user");

// signup routes
module.exports.renderSignup = (req, res) => {
  res.render("users/signup.ejs");
};

// post signup
module.exports.signupUser = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, passwordHash });

    req.login(user, (err) => {
      if (err) return next(err);
      req.flash("success", "Welcome to Wanderlust!");
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

// logout route
module.exports.logoutUser = (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    req.flash("success", "Logged out successfully!");
    res.redirect("/listings");
  });
};

