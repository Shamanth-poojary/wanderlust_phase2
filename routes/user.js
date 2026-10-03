const express = require("express");
const router = express.Router(); //so that we can access :id from parent route

const passport = require("passport");
const { saveRedirectUrl } = require("../middleware");
const { validateUser } = require("../utils/validateUser");
const wrapAsync = require("../utils/wrapAsync");
const UserController = require("../controller/user.js");

//signup routes
router
  .route("/signup")
  .get(UserController.renderSignup)
  .post(validateUser, wrapAsync(UserController.signupUser));

router
  .route("/login")
  .get(UserController.renderLogin)
  .post(
    saveRedirectUrl,
    passport.authenticate("local", {
      failureRedirect: "/login",
      failureFlash: true,
    }),
    wrapAsync(UserController.loginUser)
  );

// logout route
router.get("/logout", UserController.logoutUser);
module.exports = router;
