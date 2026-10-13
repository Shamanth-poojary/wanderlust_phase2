const express = require("express");
const router = express.Router(); //so that we can access :id from parent route

const passport = require("passport");
const { saveRedirectUrl } = require("../middleware");
const { validateUser } = require("../utils/validateUser");
const wrapAsync = require("../utils/wrapAsync");
const UserController = require("../controller/user.js");
const { uploadAvatar } = require("../cloudConfig");

const handleOptionalAvatar = (req, res, next) => {
  uploadAvatar.single("profile_picture")(req, res, (err) => {
    if (err) {
      req.avatarUploadError = err.message || "Avatar upload failed.";
    }
    next();
  });
};

//signup routes
router
  .route("/signup")
  .get(UserController.renderSignup)
  .post(handleOptionalAvatar, validateUser, wrapAsync(UserController.signupUser));

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
