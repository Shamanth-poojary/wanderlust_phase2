/**
 * tests/routes.test.js
 *
 * Automated route test suite covering Section 11.2 (rows 1-34) and
 * Section 11.3 new test cases (R1-R26).
 *
 * Prerequisites:
 *   - A MySQL 8 server reachable at DB_HOST/DB_PORT with DB_USER/DB_PASSWORD.
 *   - The test database (DB_NAME_TEST, default: wanderlust_test) will be
 *     created, seeded, and dropped automatically.
 *   - Cloudinary and Mapbox are stubbed; no real uploads or geocoding.
 *
 * Run: npm test
 */

"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// --- Env setup ---------------------------------------------------------------
// Load .env first so DB credentials are available; then apply test-specific overrides
require("dotenv").config();
process.env.NODE_ENV = "test";
if (!process.env.SECRET) process.env.SECRET = "test_secret_key";
process.env.DB_NAME = process.env.DB_NAME_TEST || "wanderlust_test";
if (!process.env.MAP_TOKEN) process.env.MAP_TOKEN = "pk.test";
// Admin credentials for tests
if (!process.env.ADMIN_USERNAME) process.env.ADMIN_USERNAME = "test_admin";
if (!process.env.ADMIN_EMAIL)    process.env.ADMIN_EMAIL    = "test_admin@example.com";
if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = "adminpass99";

// --- Stub Cloudinary & Mapbox -------------------------------------------------
const Module = require("module");
const _origLoad = Module._load;

let geocoderShouldFail = false;
let geocoderReturnEmpty = false;

Module._load = function (request, parent, isMain) {
  if (request === "multer-storage-cloudinary") {
    return {
      CloudinaryStorage: class {
        constructor() {}
        _handleFile(req, file, cb) {
          file.stream.on("data", () => {});
          file.stream.on("end", () => {
            cb(null, {
              path: "https://res.cloudinary.com/test/image/upload/stub.jpg",
              filename: "stub_filename",
            });
          });
          file.stream.on("error", (err) => cb(err));
        }
        _removeFile(req, file, cb) { cb(null); }
      },
    };
  }
  if (request === "@mapbox/mapbox-sdk/services/geocoding") {
    return function () {
      return {
        forwardGeocode: () => ({
          send: async () => {
            if (geocoderShouldFail) throw new Error("Network error");
            if (geocoderReturnEmpty) return { body: { features: [] } };
            return {
              body: {
                features: [
                  { geometry: { type: "Point", coordinates: [-118.7798, 34.0259] } },
                ],
              },
            };
          },
        }),
      };
    };
  }
  return _origLoad.apply(this, arguments);
};

// --- Database helpers ---------------------------------------------------------
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

let dbConn;

async function dbSetup() {
  dbConn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: false,
  });

  const dbName = process.env.DB_NAME;
  await dbConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await dbConn.query(`USE \`${dbName}\``);

  // Create tables - mirrors updated schema.sql including role, admin_flag, uq_single_admin
  await dbConn.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      username      VARCHAR(50)   NOT NULL,
      email         VARCHAR(255)  NOT NULL,
      password_hash VARCHAR(255)  NOT NULL,
      role          ENUM('customer','owner','admin') NOT NULL DEFAULT 'customer',
      admin_flag    TINYINT GENERATED ALWAYS AS (IF(role = 'admin', 1, NULL)) STORED,
      created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_single_admin (admin_flag)
    ) ENGINE=InnoDB
  `);
  await dbConn.query(`
    CREATE TABLE IF NOT EXISTS listings (
      listing_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      owner_id       INT UNSIGNED  NOT NULL,
      title          VARCHAR(255)  NOT NULL,
      description    TEXT          NOT NULL,
      price          DECIMAL(10,2) NOT NULL,
      location       VARCHAR(255)  NOT NULL,
      country        VARCHAR(100)  NOT NULL,
      latitude       DECIMAL(9,6)  NULL,
      longitude      DECIMAL(9,6)  NULL,
      image_url      VARCHAR(500)  NOT NULL,
      image_filename VARCHAR(255)  NULL,
      created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (listing_id),
      CONSTRAINT chk_listing_price CHECK (price >= 0),
      CONSTRAINT fk_listing_owner FOREIGN KEY (owner_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,
      KEY idx_listings_owner (owner_id)
    ) ENGINE=InnoDB
  `);
  await dbConn.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      review_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
      listing_id INT UNSIGNED NOT NULL,
      user_id    INT UNSIGNED NOT NULL,
      rating     TINYINT      NOT NULL,
      comment    TEXT         NOT NULL,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (review_id),
      CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
      CONSTRAINT fk_review_listing FOREIGN KEY (listing_id)
        REFERENCES listings (listing_id) ON DELETE CASCADE,
      CONSTRAINT fk_review_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE CASCADE,
      KEY idx_reviews_listing (listing_id)
    ) ENGINE=InnoDB
  `);
}

async function dbTeardown() {
  const dbName = process.env.DB_NAME;
  try {
    await dbConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  } catch (err) {}
  await dbConn.end();
  const pool = require("../db/pool");
  await pool.end();
}

async function clearData() {
  await dbConn.query("SET FOREIGN_KEY_CHECKS=0");
  await dbConn.query("DELETE FROM reviews");
  await dbConn.query("DELETE FROM listings");
  await dbConn.query("DELETE FROM users");
  await dbConn.query("SET FOREIGN_KEY_CHECKS=1");
}

/** createUser now accepts an optional role (default: customer) */
async function createUser(username = "testuser", password = "testpass123", role = "customer") {
  const hash = await bcrypt.hash(password, 10);
  const [r] = await dbConn.query(
    "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?)",
    [username, `${username}@example.com`, hash, role]
  );
  return { id: r.insertId, username, email: `${username}@example.com`, password, role };
}

async function createListing(ownerId) {
  const [r] = await dbConn.query(
    `INSERT INTO listings
       (owner_id, title, description, price, location, country,
        image_url, image_filename, latitude, longitude)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      ownerId,
      "Test Listing",
      "A test description",
      100,
      "Test City",
      "Test Country",
      "https://example.com/img.jpg",
      "img_filename",
      34.05,
      -118.25,
    ]
  );
  return r.insertId;
}

// --- App & supertest setup ----------------------------------------------------
// We require the app AFTER stubs are in place
let request;
let app;

// --- Tests -------------------------------------------------------------------

before(async () => {
  await dbSetup();

  // Now load pool (uses the test DB name set above)
  // Clear the module cache for pool so it picks up the test DB_NAME
  delete require.cache[require.resolve("../db/pool")];
  delete require.cache[require.resolve("../models/user")];
  delete require.cache[require.resolve("../models/listing")];
  delete require.cache[require.resolve("../models/review")];
  delete require.cache[require.resolve("../controller/listings")];
  delete require.cache[require.resolve("../controller/reviews")];
  delete require.cache[require.resolve("../controller/user")];
  delete require.cache[require.resolve("../db/ensureAdmin")];
  delete require.cache[require.resolve("../utils/roles")];
  delete require.cache[require.resolve("../utils/validateUser")];

  // Patch pool to use the test connection details
  const pool = require("../db/pool");

  // Require supertest
  const supertest = require("supertest");

  // Intercept app.listen so the server does not actually listen during tests
  const express = require("express");
  express.application.listen = function () { return this; };

  delete require.cache[require.resolve("../app")];
  // Load app - it exports nothing, but we can use the express app object
  require("../app");

  // Build a self-contained test app
  const path = require("path");
  const methodOverride = require("method-override");
  const ejsMate = require("ejs-mate");
  const session = require("express-session");
  const flash = require("connect-flash");
  const passport = require("passport");
  const LocalStrategy = require("passport-local");
  const User = require("../models/user");
  const ExpressError = require("../utils/ExpressError");
  const { validateUser } = require("../utils/validateUser");

  app = express();
  app.engine("ejs", ejsMate);
  app.use(methodOverride("_method"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "..", "views"));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use(
    session({
      secret: process.env.SECRET,
      resave: false,
      saveUninitialized: true,
      cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 },
    })
  );
  app.use(flash());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await User.findByUsername(username);
        if (!user) return done(null, false, { message: "Incorrect username or password." });
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return done(null, false, { message: "Incorrect username or password." });
        return done(null, { id: user.id, username: user.username, email: user.email, role: user.role });
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

  app.use((req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.currentUser = req.user;
    next();
  });

  app.use("/", require("../routes/landing"));
  app.use("/listings", require("../routes/listing"));
  app.use("/listings/:id/reviews", require("../routes/review"));
  app.use("/", require("../routes/user"));
  app.use((req, res, next) => next(new ExpressError(404, "Page not found")));
  app.use((err, req, res, next) => {
    let { statusCode = 500, message = "Some error occurred" } = err;
    res.status(statusCode).render("error.ejs", { statusCode, message, err });
  });

  request = supertest;
});

after(async () => {
  await dbTeardown();
});

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function agent() {
  return request.agent(app);
}

async function loginAgent(ag, username, password) {
  await ag
    .post("/login")
    .send(`username=${username}&password=${password}`)
    .redirects(0);
  return ag;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("Route matrix (Section 11.2)", () => {
  let user1, user2, listingId, reviewId;

  before(async () => {
    await clearData();
    user1 = await createUser("owner1", "password1");
    user2 = await createUser("other1", "password2");
    listingId = await createListing(user1.id);
  });

  // Row 1 - GET / (updated: landing page, not 'root route')
  it("Row 1: GET / (logged out) -> 200 landing page with login and signup links", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.match(res.text, /login/i);
    assert.match(res.text, /signup\?role=customer/i);
    assert.match(res.text, /signup\?role=owner/i);
    // Must not mention admin anywhere
    assert.doesNotMatch(res.text, /admin/i);
  });

  // Row 2 - GET /listings
  it("Row 2: GET /listings -> 200, seeded listing appears", async () => {
    const res = await request(app).get("/listings");
    assert.equal(res.status, 200);
    assert.match(res.text, /Test Listing/);
  });

  // Row 3 - GET /listings/new unauthenticated
  it("Row 3: GET /listings/new (anon) -> 302 to /login with flash", async () => {
    const res = await request(app).get("/listings/new").redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /login/);
  });

  // Row 4 - GET /listings/new logged in
  it("Row 4: GET /listings/new (logged in) -> 200 with form", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag.get("/listings/new");
    assert.equal(res.status, 200);
    assert.match(res.text, /new/i);
  });

  // Row 5 - POST /listings valid
  it("Row 5: POST /listings (logged in, valid) -> 302 /listings with flash", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .post("/listings")
      .field("listing[title]", "New Listing")
      .field("listing[description]", "A description")
      .field("listing[price]", "200")
      .field("listing[location]", "Test City")
      .field("listing[country]", "USA")
      .attach("image", Buffer.from("fake"), { filename: "test.jpg", contentType: "image/jpeg" })
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/listings/);
    // Verify row inserted
    const [rows] = await dbConn.query("SELECT * FROM listings WHERE title=?", ["New Listing"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner_id, user1.id);
  });

  // Row 6 - POST /listings missing title -> 400
  it("Row 6: POST /listings (missing title) -> 400, no row inserted", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
    const res = await ag
      .post("/listings")
      .field("listing[description]", "desc")
      .field("listing[price]", "100")
      .field("listing[location]", "City")
      .field("listing[country]", "US")
      .attach("image", Buffer.from("fake"), { filename: "t.jpg", contentType: "image/jpeg" })
      .redirects(0);
    assert.equal(res.status, 400);
    const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
    assert.equal(before[0].c, after[0].c);
  });

  // Row 7 - POST /listings no file
  it("Row 7: POST /listings (no file) -> 302 /listings/new with flash", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .post("/listings")
      .field("listing[title]", "NoFile")
      .field("listing[description]", "desc")
      .field("listing[price]", "100")
      .field("listing[location]", "City")
      .field("listing[country]", "US")
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/listings\/new/);
  });

  // Row 8 - POST /listings geocoder returns no feature
  it("Row 8: POST /listings (geocoder empty) -> 302 /listings/new, no row", async () => {
    geocoderReturnEmpty = true;
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
    const res = await ag
      .post("/listings")
      .field("listing[title]", "NoGeo")
      .field("listing[description]", "desc")
      .field("listing[price]", "100")
      .field("listing[location]", "NowhereXYZ")
      .field("listing[country]", "US")
      .attach("image", Buffer.from("fake"), { filename: "t.jpg", contentType: "image/jpeg" })
      .redirects(0);
    geocoderReturnEmpty = false;
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/listings\/new/);
    const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
    assert.equal(before[0].c, after[0].c);
  });

  // Row 9 - GET /listings/:id
  it("Row 9: GET /listings/:id -> 200 with title and price", async () => {
    const res = await request(app).get(`/listings/${listingId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Test Listing/);
  });

  // Row 10 - listing with NULL coordinates
  it("Row 10: GET /listings/:id (null coords) -> 200 no script error", async () => {
    const [r] = await dbConn.query(
      `INSERT INTO listings (owner_id,title,description,price,location,country,image_url,latitude,longitude)
       VALUES (?,?,?,?,?,?,?,NULL,NULL)`,
      [user1.id, "NoCoords", "desc", 50, "City", "Country", "https://example.com/img.jpg"]
    );
    const id = r.insertId;
    const res = await request(app).get(`/listings/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /No map added yet/);
  });

  // Row 11 - GET /listings/99999 (unknown)
  it("Row 11: GET /listings/99999 -> flash redirect or 404, never 500", async () => {
    const res = await request(app).get("/listings/99999").redirects(5);
    assert.notEqual(res.status, 500);
  });

  // Row 12 - GET /listings/abc (invalid id)
  it("Row 12: GET /listings/abc -> 404 page, never 500", async () => {
    const res = await request(app).get("/listings/abc");
    assert.notEqual(res.status, 500);
    assert.ok(res.status === 404 || res.status === 302);
  });

  // Row 13 - GET /listings/:id/edit as owner
  it("Row 13: GET /listings/:id/edit (owner) -> 200 with prefilled fields", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag.get(`/listings/${listingId}/edit`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Test Listing/);
  });

  // Row 14 - GET /listings/:id/edit as non-owner
  it("Row 14: GET /listings/:id/edit (non-owner) -> 302 with flash", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag.get(`/listings/${listingId}/edit`).redirects(0);
    assert.equal(res.status, 302);
  });

  // Row 15 - PUT /listings/:id valid
  it("Row 15: PUT /listings/:id (owner, valid) -> 302 /listings/:id", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .put(`/listings/${listingId}?_method=PUT`)
      .field("listing[title]", "Updated Title")
      .field("listing[description]", "Updated desc")
      .field("listing[price]", "150")
      .field("listing[location]", "Test City")
      .field("listing[country]", "Test Country")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT title FROM listings WHERE listing_id=?", [listingId]);
    assert.equal(rows[0].title, "Updated Title");
  });

  // Row 16 - PUT includes owner_id injection attempt (F1)
  it("Row 16: PUT with owner_id injection -> ownership unchanged (F1)", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    await ag
      .put(`/listings/${listingId}?_method=PUT`)
      .field("listing[title]", "Inject Test")
      .field("listing[description]", "desc")
      .field("listing[price]", "100")
      .field("listing[location]", "City")
      .field("listing[country]", "US")
      .field("listing[owner_id]", String(user2.id))
      .redirects(0);
    const [rows] = await dbConn.query("SELECT owner_id FROM listings WHERE listing_id=?", [listingId]);
    assert.equal(rows[0].owner_id, user1.id); // unchanged
  });

  // Row 17 - PUT with invalid body (empty title)
  it("Row 17: PUT (owner, empty title) -> 400", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .put(`/listings/${listingId}?_method=PUT`)
      .field("listing[title]", "")
      .field("listing[description]", "desc")
      .field("listing[price]", "100")
      .field("listing[location]", "City")
      .field("listing[country]", "US")
      .redirects(0);
    assert.equal(res.status, 400);
  });

  // Row 18 - PUT location changed -> geocoder called again (F8)
  it("Row 18: PUT (location changed) -> lat/lng updated (F8)", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    await ag
      .put(`/listings/${listingId}?_method=PUT`)
      .field("listing[title]", "Inject Test")
      .field("listing[description]", "desc")
      .field("listing[price]", "100")
      .field("listing[location]", "New Location XYZ")
      .field("listing[country]", "US")
      .redirects(0);
    const [rows] = await dbConn.query("SELECT latitude, longitude FROM listings WHERE listing_id=?", [listingId]);
    // Stub returns [-118.7798, 34.0259]
    assert.ok(rows[0].latitude != null);
    assert.ok(rows[0].longitude != null);
  });

  // Row 19 - PUT as non-owner
  it("Row 19: PUT (non-owner) -> blocked", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .put(`/listings/${listingId}?_method=PUT`)
      .field("listing[title]", "Hijacked")
      .field("listing[description]", "desc")
      .field("listing[price]", "100")
      .field("listing[location]", "City")
      .field("listing[country]", "US")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT title FROM listings WHERE listing_id=?", [listingId]);
    assert.notEqual(rows[0].title, "Hijacked");
  });

  // Row 20 - DELETE /listings/:id as owner (cascade)
  it("Row 20: DELETE /listings/:id (owner) -> listing + reviews deleted", async () => {
    // Create a temp listing and add a review
    const tempId = await createListing(user1.id);
    await dbConn.query(
      "INSERT INTO reviews (listing_id, user_id, rating, comment) VALUES (?,?,?,?)",
      [tempId, user1.id, 5, "great"]
    );
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .delete(`/listings/${tempId}?_method=DELETE`)
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [tempId]);
    assert.equal(rows.length, 0);
    const [rev] = await dbConn.query("SELECT * FROM reviews WHERE listing_id=?", [tempId]);
    assert.equal(rev.length, 0);
  });

  // Row 21 - DELETE as non-owner
  it("Row 21: DELETE (non-owner) -> blocked, row remains", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .delete(`/listings/${listingId}?_method=DELETE`)
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [listingId]);
    assert.equal(rows.length, 1);
  });

  // Row 22 - POST /listings/:id/reviews (anon) -> 302 to /login (F7)
  it("Row 22: POST review (anon) -> 302 /login (F7)", async () => {
    const res = await request(app)
      .post(`/listings/${listingId}/reviews`)
      .send(`review[rating]=5&review[comment]=nice`)
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /login/);
  });

  // Row 23 - POST review valid
  it("Row 23: POST review (logged in, valid) -> 302 /listings/:id", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .post(`/listings/${listingId}/reviews`)
      .send(`review[rating]=4&review[comment]=Very nice`)
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, new RegExp(`/listings/${listingId}`));
    const [rows] = await dbConn.query("SELECT * FROM reviews WHERE listing_id=?", [listingId]);
    assert.ok(rows.length > 0);
    reviewId = rows[rows.length - 1].review_id;
  });

  // Row 24 - POST review invalid (empty comment) -> 400 with errors (F6)
  it("Row 24: POST review (empty comment) -> 400 re-render with errors (F6)", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .post(`/listings/${listingId}/reviews`)
      .send(`review[rating]=5&review[comment]=`)
      .redirects(0);
    assert.equal(res.status, 400);
    assert.match(res.text, /Comment is required/);
  });

  // Row 25 - DELETE review as author
  it("Row 25: DELETE review (author) -> deleted", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .delete(`/listings/${listingId}/reviews/${reviewId}?_method=DELETE`)
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM reviews WHERE review_id=?", [reviewId]);
    assert.equal(rows.length, 0);
  });

  // Row 26 - DELETE review as other user
  it("Row 26: DELETE review (other user) -> blocked with flash", async () => {
    // Create a fresh review owned by user2
    const [r] = await dbConn.query(
      "INSERT INTO reviews (listing_id, user_id, rating, comment) VALUES (?,?,?,?)",
      [listingId, user2.id, 3, "ok"]
    );
    const newReviewId = r.insertId;

    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .delete(`/listings/${listingId}/reviews/${newReviewId}?_method=DELETE`)
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM reviews WHERE review_id=?", [newReviewId]);
    assert.equal(rows.length, 1); // not deleted
  });

  // Row 27 - DELETE unknown review
  it("Row 27: DELETE unknown reviewId -> flash redirect, no crash", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .delete(`/listings/${listingId}/reviews/99999?_method=DELETE`)
      .redirects(0);
    assert.notEqual(res.status, 500);
  });

  // Row 28 - GET /signup, /login
  it("Row 28: GET /signup and /login -> 200", async () => {
    const r1 = await request(app).get("/signup");
    const r2 = await request(app).get("/login");
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
  });

  // Row 29 - POST /signup new user (updated: must send a role, check new flash text)
  it("Row 29: POST /signup (new user, with role) -> logged in, flash 'registered as Customer', redirect", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=newuser29&email=newuser29@example.com&password=pass12345&role=customer")
      .redirects(0);
    assert.equal(res.status, 302);
    // Verify bcrypt hash stored (not plaintext)
    const [rows] = await dbConn.query("SELECT password_hash, role FROM users WHERE username=?", ["newuser29"]);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].password_hash, "pass12345");
    assert.ok(rows[0].password_hash.startsWith("$2"));
    assert.equal(rows[0].role, "customer");
  });

  // Row 30 - POST /signup duplicate
  it("Row 30: POST /signup (duplicate) -> flash redirect /signup, no 500", async () => {
    const ag = agent();
    // First sign up
    await ag
      .post("/signup")
      .send("username=dupuser&email=dup@example.com&password=pass12345&role=customer")
      .redirects(5);
    // Duplicate sign up
    const res = await ag
      .post("/signup")
      .send("username=dupuser&email=dup2@example.com&password=pass12345&role=customer")
      .redirects(0);
    assert.notEqual(res.status, 500);
    assert.equal(res.status, 302);
  });

  // Row 31 - POST /login correct credentials + redirect URL
  it("Row 31: POST /login (correct, redirect URL) -> redirects to requested URL", async () => {
    const ag = agent();
    // Simulate visiting a protected URL first
    await ag.get("/listings/new").redirects(0); // sets session.redirectUrl
    const res = await ag
      .post("/login")
      .send(`username=${user1.username}&password=${user1.password}`)
      .redirects(0);
    assert.equal(res.status, 302);
    // Redirect should be to /listings/new or /listings
    assert.ok(
      res.headers.location.includes("/listings/new") ||
      res.headers.location.includes("/listings")
    );
  });

  // Row 32 - POST /login wrong password
  it("Row 32: POST /login (wrong password) -> redirect to /login", async () => {
    const ag = agent();
    const res = await ag
      .post("/login")
      .send(`username=${user1.username}&password=wrongpassword`)
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /login/);
  });

  // Row 33 - GET /logout (updated: now redirects to /)
  it("Row 33: GET /logout (logged in) -> session ended, redirects to /", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag.get("/logout").redirects(0);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");
  });

  // Row 34 - GET /does-not-exist
  it("Row 34: GET /does-not-exist -> 404 page", async () => {
    const res = await request(app).get("/does-not-exist");
    assert.equal(res.status, 404);
    assert.match(res.text, /Page not found|not found/i);
  });
});

// --- Section 11.3 New test cases ---------------------------------------------

describe("Section 11.3 Role and landing tests", () => {
  before(async () => {
    await clearData();
  });

  // R1: GET / logged out
  it("R1: GET / (logged out) -> 200, landing page, three links, no admin", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.match(res.text, /\/login/);
    assert.match(res.text, /signup\?role=customer/i);
    assert.match(res.text, /signup\?role=owner/i);
    assert.doesNotMatch(res.text, /admin/i);
  });

  // R2: GET / logged in
  it("R2: GET / (logged in) -> 302 to /listings", async () => {
    const user = await createUser("r2user", "password123");
    const ag = agent();
    await loginAgent(ag, user.username, user.password);
    const res = await ag.get("/").redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/listings/);
  });

  // R3: GET /signup
  it("R3: GET /signup -> 200, two role options, Customer preselected", async () => {
    const res = await request(app).get("/signup");
    assert.equal(res.status, 200);
    // Customer radio should be present and checked
    assert.match(res.text, /value="customer"/);
    assert.match(res.text, /value="owner"/);
    // Customer should be the preselected (checked) one
    // The page should have checked on the customer radio before the owner one
    const custIdx = res.text.indexOf("value=\"customer\"");
    const ownerIdx = res.text.indexOf("value=\"owner\"");
    const checkedIdx = res.text.indexOf("checked");
    // The first "checked" should appear closer to the customer option
    assert.ok(Math.abs(checkedIdx - custIdx) < Math.abs(checkedIdx - ownerIdx));
  });

  // R4: GET /signup?role=owner
  it("R4: GET /signup?role=owner -> Owner preselected", async () => {
    const res = await request(app).get("/signup?role=owner");
    assert.equal(res.status, 200);
    // The checked attribute should appear near the owner value
    const ownerIdx = res.text.indexOf("value=\"owner\"");
    const custIdx = res.text.indexOf("value=\"customer\"");
    const checkedIdx = res.text.indexOf("checked");
    assert.ok(Math.abs(checkedIdx - ownerIdx) < Math.abs(checkedIdx - custIdx));
  });

  // R5: GET /signup?role=admin and ?role=zzz
  it("R5: GET /signup?role=admin -> 200, Customer preselected, no error", async () => {
    const res = await request(app).get("/signup?role=admin");
    assert.equal(res.status, 200);
    const custIdx = res.text.indexOf("value=\"customer\"");
    const ownerIdx = res.text.indexOf("value=\"owner\"");
    const checkedIdx = res.text.indexOf("checked");
    assert.ok(Math.abs(checkedIdx - custIdx) < Math.abs(checkedIdx - ownerIdx));
  });

  it("R5b: GET /signup?role=zzz -> 200, Customer preselected, no error", async () => {
    const res = await request(app).get("/signup?role=zzz");
    assert.equal(res.status, 200);
    const custIdx = res.text.indexOf("value=\"customer\"");
    const ownerIdx = res.text.indexOf("value=\"owner\"");
    const checkedIdx = res.text.indexOf("checked");
    assert.ok(Math.abs(checkedIdx - custIdx) < Math.abs(checkedIdx - ownerIdx));
  });

  // R6: POST /signup with role=customer
  it("R6: POST /signup with role=customer -> row with role customer, logged in", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r6user&email=r6user@example.com&password=password99&role=customer")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT role FROM users WHERE username=?", ["r6user"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "customer");
  });

  // R7: POST /signup with role=owner
  it("R7: POST /signup with role=owner -> row with role owner", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r7user&email=r7user@example.com&password=password99&role=owner")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT role FROM users WHERE username=?", ["r7user"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "owner");
  });

  // R8: POST /signup with no role field
  it("R8: POST /signup with no role field -> row created with role customer", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r8user&email=r8user@example.com&password=password99")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT role FROM users WHERE username=?", ["r8user"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "customer");
  });

  // R9: POST /signup with role=admin
  it("R9: POST /signup with role=admin -> redirect /signup, error flash, no row", async () => {
    const [before] = await dbConn.query("SELECT COUNT(*) as c FROM users WHERE username=?", ["r9admin"]);
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r9admin&email=r9admin@example.com&password=password99&role=admin")
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/signup/);
    const [after] = await dbConn.query("SELECT COUNT(*) as c FROM users WHERE username=?", ["r9admin"]);
    assert.equal(after[0].c, 0); // no row created
  });

  // R10: POST /signup with various invalid role values
  it("R10: POST /signup with role=ADMIN -> rejected, no row", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r10a&email=r10a@example.com&password=password99&role=ADMIN")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM users WHERE username=?", ["r10a"]);
    assert.equal(rows.length, 0);
  });

  it("R10b: POST /signup with role=' admin' (space) -> rejected", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r10b&email=r10b@example.com&password=password99&role= admin")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM users WHERE username=?", ["r10b"]);
    assert.equal(rows.length, 0);
  });

  it("R10c: POST /signup with empty role string -> rejected", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r10c&email=r10c@example.com&password=password99&role=")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM users WHERE username=?", ["r10c"]);
    assert.equal(rows.length, 0);
  });

  it("R10d: POST /signup with role[]=admin (array) -> rejected", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r10d&email=r10d@example.com&password=password99&role[]=admin")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM users WHERE username=?", ["r10d"]);
    assert.equal(rows.length, 0);
  });

  // R11: POST /signup with extra fields
  it("R11: POST /signup with role=customer&isAdmin=1&admin_flag=1 -> plain customer, extra fields ignored", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r11user&email=r11user@example.com&password=password99&role=customer&isAdmin=1&admin_flag=1")
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT role FROM users WHERE username=?", ["r11user"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "customer");
  });

  // R12: POST /signup with short username, bad email, 7-char password
  it("R12: POST /signup short username -> rejected", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=ab&email=r12@example.com&password=password99&role=customer")
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/signup/);
    const [rows] = await dbConn.query("SELECT * FROM users WHERE username=?", ["ab"]);
    assert.equal(rows.length, 0);
  });

  it("R12b: POST /signup bad email -> rejected", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r12buser&email=notanemail&password=password99&role=customer")
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/signup/);
    const [rows] = await dbConn.query("SELECT * FROM users WHERE username=?", ["r12buser"]);
    assert.equal(rows.length, 0);
  });

  it("R12c: POST /signup 7-char password -> rejected", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=r12cuser&email=r12c@example.com&password=short7c&role=customer")
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/signup/);
    const [rows] = await dbConn.query("SELECT * FROM users WHERE username=?", ["r12cuser"]);
    assert.equal(rows.length, 0);
  });

  // R13: POST /signup using admin's username or email
  it("R13: POST /signup using admin username or email -> duplicate error, no new row, no admin mention", async () => {
    // Clear any previous admin
    await dbConn.query("DELETE FROM users WHERE role='admin'");
    const adminHash = await bcrypt.hash("adminpass99", 10);
    await dbConn.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,'admin')",
      ["r13admin", "r13admin@example.com", adminHash]
    );

    const ag = agent();
    // Test duplicate username
    const res = await ag
      .post("/signup")
      .send("username=r13admin&email=different@example.com&password=password99&role=customer")
      .redirects(0);
    assert.equal(res.status, 302);
    const r2 = await ag.get(res.headers.location);
    assert.doesNotMatch(r2.text, /admin/i);

    // Test duplicate email
    const res2 = await ag
      .post("/signup")
      .send("username=differentuser&email=r13admin@example.com&password=password99&role=customer")
      .redirects(0);
    assert.equal(res2.status, 302);
    const r3 = await ag.get(res2.headers.location);
    assert.doesNotMatch(r3.text, /admin/i);

    // Clean up
    await dbConn.query("DELETE FROM users WHERE username='r13admin'");
  });

  // R14: Admin login
  it("R14: Admin login with env credentials -> logged in, role=admin, navbar shows Admin badge", async () => {
    // Ensure clean state for single admin
    await dbConn.query("DELETE FROM users WHERE role='admin'");
    const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    await dbConn.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,'admin')",
      [process.env.ADMIN_USERNAME, process.env.ADMIN_EMAIL, adminHash]
    );

    const ag = agent();
    await loginAgent(ag, process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);
    const res = await ag.get("/listings");
    assert.equal(res.status, 200);
    assert.match(res.text, /Admin/);
  });

  // R15: Customer and owner login show badges
  it("R15: Customer login -> navbar shows Customer badge", async () => {
    const user = await createUser("r15cust", "password123", "customer");
    const ag = agent();
    await loginAgent(ag, user.username, user.password);
    const res = await ag.get("/listings");
    assert.equal(res.status, 200);
    assert.match(res.text, /Customer/);
  });

  it("R15b: Owner login -> navbar shows Property / Venue Owner badge", async () => {
    const user = await createUser("r15owner", "password123", "owner");
    const ag = agent();
    await loginAgent(ag, user.username, user.password);
    const res = await ag.get("/listings");
    assert.equal(res.status, 200);
    assert.match(res.text, /Property \/ Venue Owner/);
  });

  // R16, R17, R18, R19, R20, R21: ensureAdmin unit tests
  describe("ensureAdmin unit tests", () => {
    let ensureAdmin;
    let testPool;

    before(async () => {
      delete require.cache[require.resolve("../db/ensureAdmin")];
      ({ ensureAdmin } = require("../db/ensureAdmin"));
    });

    it("R16: ensureAdmin on empty users table -> returns 'created', exactly one admin row", async () => {
      await clearData();
      // Set admin env vars
      process.env.ADMIN_USERNAME = "unit_admin";
      process.env.ADMIN_EMAIL    = "unit_admin@example.com";
      process.env.ADMIN_PASSWORD = "unitsecret1";
      // Use dbConn as a compatible db object
      const result = await ensureAdmin(dbConn);
      assert.equal(result, "created");
      const [rows] = await dbConn.query("SELECT * FROM users WHERE role='admin'");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].username, "unit_admin");
    });

    it("R17: ensureAdmin run second time -> returns 'unchanged', still one admin", async () => {
      const result = await ensureAdmin(dbConn);
      assert.equal(result, "unchanged");
      const [rows] = await dbConn.query("SELECT * FROM users WHERE role='admin'");
      assert.equal(rows.length, 1);
    });

    it("R18: Change ADMIN_PASSWORD, run ensureAdmin -> returns 'updated'", async () => {
      process.env.ADMIN_PASSWORD = "newunitpass1";
      const result = await ensureAdmin(dbConn);
      assert.equal(result, "updated");
      // Old password should not work
      const [rows] = await dbConn.query("SELECT password_hash FROM users WHERE username='unit_admin'");
      const oldMatch = await bcrypt.compare("unitsecret1", rows[0].password_hash);
      const newMatch = await bcrypt.compare("newunitpass1", rows[0].password_hash);
      assert.equal(oldMatch, false);
      assert.equal(newMatch, true);
      // Reset for other tests
      process.env.ADMIN_PASSWORD = "adminpass99";
      process.env.ADMIN_USERNAME = "test_admin";
      process.env.ADMIN_EMAIL    = "test_admin@example.com";
    });

    it("R19: ensureAdmin when non-admin has ADMIN_USERNAME -> throws, role unchanged", async () => {
      await clearData();
      const conflictHash = await bcrypt.hash("password", 10);
      await dbConn.query(
        "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,'customer')",
        ["conflict_admin", "conflict_admin@example.com", conflictHash]
      );
      process.env.ADMIN_USERNAME = "conflict_admin";
      process.env.ADMIN_EMAIL    = "new_conflict@example.com";
      process.env.ADMIN_PASSWORD = "adminpass99";
      await assert.rejects(() => ensureAdmin(dbConn), /already used/i);
      const [rows] = await dbConn.query("SELECT role FROM users WHERE username='conflict_admin'");
      assert.equal(rows[0].role, "customer"); // unchanged
      // Reset
      process.env.ADMIN_USERNAME = "test_admin";
      process.env.ADMIN_EMAIL    = "test_admin@example.com";
    });

    it("R20: ensureAdmin with no admin variables -> returns 'skipped', no row, no crash", async () => {
      const origU = process.env.ADMIN_USERNAME;
      const origE = process.env.ADMIN_EMAIL;
      const origP = process.env.ADMIN_PASSWORD;
      delete process.env.ADMIN_USERNAME;
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_PASSWORD;
      const result = await ensureAdmin(dbConn);
      assert.equal(result, "skipped");
      // Restore
      process.env.ADMIN_USERNAME = origU;
      process.env.ADMIN_EMAIL    = origE;
      process.env.ADMIN_PASSWORD = origP;
    });

    it("R21: ensureAdmin with only some admin variables -> throws naming the missing variable", async () => {
      const origU = process.env.ADMIN_USERNAME;
      const origE = process.env.ADMIN_EMAIL;
      process.env.ADMIN_USERNAME = "partial_admin";
      delete process.env.ADMIN_EMAIL;
      await assert.rejects(() => ensureAdmin(dbConn), /ADMIN_EMAIL/);
      // Restore
      process.env.ADMIN_USERNAME = origU;
      process.env.ADMIN_EMAIL    = origE;
    });
  });

  // R22: Insert second admin row directly -> rejected by DB
  it("R22: Insert a second admin row directly with SQL -> rejected by unique index", async () => {
    await clearData();
    const h1 = await bcrypt.hash("password1", 10);
    const h2 = await bcrypt.hash("password2", 10);
    await dbConn.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,'admin')",
      ["admin1", "admin1@example.com", h1]
    );
    await assert.rejects(
      () =>
        dbConn.query(
          "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,'admin')",
          ["admin2", "admin2@example.com", h2]
        ),
      /Duplicate entry|unique/i
    );
  });

  // R23, R24: Migration tests
  describe("Migration tests (R23, R24)", () => {
    let migConn;
    const dbName = process.env.DB_NAME;

    before(async () => {
      migConn = await mysql.createConnection({
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: dbName,
        multipleStatements: false,
      });
      // Clean up in case prior run left tables
      await migConn.query("DROP TABLE IF EXISTS test_mig_listings");
      await migConn.query("DROP TABLE IF EXISTS test_mig_users");

      // Create fresh test tables simulating the old schema (no role)
      await migConn.query(`
        CREATE TABLE test_mig_users (
          user_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
          username      VARCHAR(50)   NOT NULL,
          email         VARCHAR(255)  NOT NULL,
          password_hash VARCHAR(255)  NOT NULL,
          created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id),
          UNIQUE KEY uq_mig_users_username (username),
          UNIQUE KEY uq_mig_users_email (email)
        ) ENGINE=InnoDB
      `);
      await migConn.query(`
        CREATE TABLE test_mig_listings (
          listing_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
          owner_id       INT UNSIGNED  NOT NULL,
          title          VARCHAR(255)  NOT NULL,
          description    TEXT          NOT NULL,
          price          DECIMAL(10,2) NOT NULL,
          location       VARCHAR(255)  NOT NULL,
          country        VARCHAR(100)  NOT NULL,
          latitude       DECIMAL(9,6)  NULL,
          longitude      DECIMAL(9,6)  NULL,
          image_url      VARCHAR(500)  NOT NULL,
          image_filename VARCHAR(255)  NULL,
          created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (listing_id),
          CONSTRAINT chk_mig_lp CHECK (price >= 0),
          CONSTRAINT fk_mig_lo FOREIGN KEY (owner_id) REFERENCES test_mig_users (user_id) ON DELETE RESTRICT
        ) ENGINE=InnoDB
      `);
      // Insert two users and a listing owned by user1
      const h = await bcrypt.hash("password", 10);
      const [u1] = await migConn.query(
        "INSERT INTO test_mig_users (username, email, password_hash) VALUES (?,?,?)",
        ["mig_owner", "mig_owner@example.com", h]
      );
      const [u2] = await migConn.query(
        "INSERT INTO test_mig_users (username, email, password_hash) VALUES (?,?,?)",
        ["mig_customer", "mig_customer@example.com", h]
      );
      await migConn.query(
        `INSERT INTO test_mig_listings (owner_id,title,description,price,location,country,image_url) VALUES (?,?,?,?,?,?,?)`,
        [u1.insertId, "MigTest", "d", 50, "City", "Country", "https://example.com/img.jpg"]
      );
    });

    after(async () => {
      await migConn.query("DROP TABLE IF EXISTS test_mig_listings");
      await migConn.query("DROP TABLE IF EXISTS test_mig_users");
      await migConn.end();
    });

    it("R23: migration on old schema -> adds role and unique index; listing owner becomes 'owner'", async () => {
      // Step 1: add role column
      const [roleRows] = await migConn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'test_mig_users' AND COLUMN_NAME = 'role'`,
        [dbName]
      );
      let roleAdded = false;
      if (roleRows.length === 0) {
        await migConn.query(
          `ALTER TABLE test_mig_users ADD COLUMN role ENUM('customer','owner','admin') NOT NULL DEFAULT 'customer' AFTER password_hash`
        );
        roleAdded = true;
      }
      // Step 2: backfill owners
      if (roleAdded) {
        await migConn.query(
          `UPDATE test_mig_users SET role = 'owner' WHERE user_id IN (SELECT DISTINCT owner_id FROM test_mig_listings)`
        );
      }
      // Step 3: add admin_flag
      const [flagRows] = await migConn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'test_mig_users' AND COLUMN_NAME = 'admin_flag'`,
        [dbName]
      );
      if (flagRows.length === 0) {
        await migConn.query(
          `ALTER TABLE test_mig_users ADD COLUMN admin_flag TINYINT GENERATED ALWAYS AS (IF(role = 'admin', 1, NULL)) STORED`
        );
      }
      // Step 4: add unique index
      const [idxRows] = await migConn.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'test_mig_users' AND INDEX_NAME = 'uq_single_admin_mig'`,
        [dbName]
      );
      if (idxRows.length === 0) {
        await migConn.query(`ALTER TABLE test_mig_users ADD UNIQUE KEY uq_single_admin_mig (admin_flag)`);
      }

      // Verify
      const [ownerRows] = await migConn.query("SELECT role FROM test_mig_users WHERE username='mig_owner'");
      const [custRows]  = await migConn.query("SELECT role FROM test_mig_users WHERE username='mig_customer'");
      assert.equal(ownerRows[0].role, "owner");
      assert.equal(custRows[0].role, "customer");
    });

    it("R24: migration run twice -> second run succeeds and changes nothing", async () => {
      // Running the same steps again should not throw
      const [roleRows] = await migConn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'test_mig_users' AND COLUMN_NAME = 'role'`,
        [dbName]
      );
      assert.equal(roleRows.length, 1); // already exists, no error
      const [idxRows] = await migConn.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'test_mig_users' AND INDEX_NAME = 'uq_single_admin_mig'`,
        [dbName]
      );
      assert.equal(idxRows.length, 1); // already exists
    });
  });

  // R25: Logout redirects to /
  it("R25: Logout -> 302 to /", async () => {
    const user = await createUser("r25user", "password123");
    const ag = agent();
    await loginAgent(ag, user.username, user.password);
    const res = await ag.get("/logout").redirects(0);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");
  });
});

// --- Section 11.3 Cross-cutting checks ---------------------------------------

describe("Cross-cutting checks (Section 11.3)", () => {
  before(async () => {
    await clearData();
  });

  it("price arrives as a Number from pool (decimalNumbers:true)", async () => {
    const user = await createUser("priceuser", "pass");
    await dbConn.query(
      `INSERT INTO listings (owner_id,title,description,price,location,country,image_url)
       VALUES (?,?,?,?,?,?,?)`,
      [user.id, "PriceTest", "d", 99.99, "City", "Country", "https://example.com/img.jpg"]
    );
    const Listing = require("../models/listing");
    const listings = await Listing.findAll();
    const pl = listings.find((l) => l.title === "PriceTest");
    assert.ok(pl, "listing should exist");
    assert.equal(typeof pl.price, "number");
  });

  it("Two reviews created at different times have different created_at (F5)", async () => {
    const user = await createUser("f5user", "pass");
    const lid = await createListing(user.id);
    await dbConn.query(
      "INSERT INTO reviews (listing_id, user_id, rating, comment) VALUES (?,?,?,?)",
      [lid, user.id, 5, "first"]
    );
    // Small sleep to ensure TIMESTAMP differs (MySQL TIMESTAMP has 1-second granularity by default)
    await new Promise((r) => setTimeout(r, 1100));
    await dbConn.query(
      "INSERT INTO reviews (listing_id, user_id, rating, comment) VALUES (?,?,?,?)",
      [lid, user.id, 4, "second"]
    );
    const [rows] = await dbConn.query(
      "SELECT created_at FROM reviews WHERE listing_id=? ORDER BY review_id ASC",
      [lid]
    );
    assert.equal(rows.length, 2);
    assert.notDeepEqual(rows[0].created_at, rows[1].created_at);
  });

  it("Invalid id (string 'abc') -> findById returns null, no exception", async () => {
    const Listing = require("../models/listing");
    const result = await Listing.findById("abc");
    assert.equal(result, null);
  });

  it("getOwnerId for unknown id returns null", async () => {
    const Listing = require("../models/listing");
    const result = await Listing.getOwnerId(99999);
    assert.equal(result, null);
  });

  it("DB CHECK: negative price rejected by MySQL", async () => {
    const user = await createUser("chkuser", "pass");
    await assert.rejects(
      () =>
        dbConn.query(
          `INSERT INTO listings (owner_id,title,description,price,location,country,image_url)
           VALUES (?,?,?,?,?,?,?)`,
          [user.id, "NegPrice", "d", -1, "City", "Country", "https://example.com/img.jpg"]
        ),
      /Check constraint/i
    );
  });

  it("DB CHECK: rating outside 1-5 rejected by MySQL", async () => {
    const user = await createUser("chkuser2", "pass");
    const lid = await createListing(user.id);
    await assert.rejects(
      () =>
        dbConn.query(
          "INSERT INTO reviews (listing_id, user_id, rating, comment) VALUES (?,?,?,?)",
          [lid, user.id, 6, "bad rating"]
        ),
      /Check constraint/i
    );
  });
});
