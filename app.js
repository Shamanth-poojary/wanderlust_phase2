if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// F2: Fail fast if SECRET is missing; do NOT log it
if (!process.env.SECRET) {
  console.error("FATAL: environment variable SECRET is not set. Exiting.");
  process.exit(1);
}

const express = require("express");
const app = express();
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const ExpressError = require("./utils/ExpressError");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const bcrypt = require("bcryptjs");
const User = require("./models/user");
const pool = require("./db/pool");
const path = require("path");
const { ensureAdmin } = require("./db/ensureAdmin");

app.engine("ejs", ejsMate);
app.use(methodOverride("_method"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));
app.use(express.static(path.join(__dirname, "public")));

// F3: httpOnly: true (was misspelled), removed expires, kept maxAge
const sessionOptions = {
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
  },
};
app.use(session(sessionOptions));
app.use(flash());

// Passport config - replaces passport-local-mongoose
app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await User.findByUsername(username);
      if (!user) return done(null, false, { message: "Incorrect username or password." });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return done(null, false, { message: "Incorrect username or password." });
      return done(null, {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        ownerStatus: user.ownerStatus || null,
      });
    } catch (err) {
      return done(err);
    }
  })
);
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, (await User.findById(id)) || false);
  } catch (err) {
    done(err);
  }
});

const { isApprovedOwner } = require("./utils/permissions");
const OwnerProfile        = require("./models/ownerProfile");

// Flash / currentUser locals middleware
app.use(async (req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error   = req.flash("error");
  res.locals.info    = req.flash("info");
  res.locals.currentUser = req.user;
  res.locals.canManageListings = isApprovedOwner(req.user);
  res.locals.pendingOwnerCount = 0;
  if (req.user && req.user.role === "admin") {
    try {
      const counts = await OwnerProfile.countsByStatus();
      res.locals.pendingOwnerCount = counts.pending;
    } catch (err) {
      res.locals.pendingOwnerCount = 0;
    }
  }
  next();
});

// Routes
const landingRoute = require("./routes/landing");
app.use("/", landingRoute);

const listingRoutes = require("./routes/listing");
app.use("/listings", listingRoutes);

const reviewRoutes = require("./routes/review");
app.use("/listings/:id/reviews", reviewRoutes);

const ownerRoutes = require("./routes/owner");
app.use("/owner", ownerRoutes);

const adminRoutes = require("./routes/admin");
app.use("/admin", adminRoutes);

const userRoutes = require("./routes/user");
app.use("/", userRoutes);

// 404 handler
app.use((req, res, next) => {
  next(new ExpressError(404, "Page not found"));
});

// Custom error handler
app.use((err, req, res, next) => {
  let { statusCode = 500, message = "Some error occurred" } = err;
  res.status(statusCode).render("error.ejs", { statusCode, message, err });
});

// Verify pool connectivity, run ensureAdmin, then start server
pool
  .execute("SELECT 1")
  .then(async () => {
    try {
      const status = await ensureAdmin();
      console.log("Admin bootstrap status:", status);
    } catch (err) {
      console.error("FATAL: ensureAdmin failed:", err.message);
      process.exit(1);
    }
    app.listen(8080, () => console.log("Server started on port 8080"));
  })
  .catch((err) => {
    console.error("FATAL: Cannot connect to MySQL:", err.message);
    process.exit(1);
  });
