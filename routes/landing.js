/**
 * routes/landing.js
 * Handles GET / – the public landing page.
 * Logged-in visitors are redirected to /listings.
 */

"use strict";

const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect("/listings");
  }
  res.render("landing.ejs");
});

module.exports = router;
