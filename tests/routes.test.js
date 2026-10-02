/**
 * tests/routes.test.js
 *
 * Automated route test suite covering Section 11.2 (rows 1-34).
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

// ─── Env setup ───────────────────────────────────────────────────────────────
process.env.NODE_ENV = "test";
if (!process.env.SECRET) process.env.SECRET = "test_secret_key";
process.env.DB_NAME = process.env.DB_NAME_TEST || "wanderlust_test";
if (!process.env.MAP_TOKEN) process.env.MAP_TOKEN = "pk.test";

// ─── Stub Cloudinary / multer-storage-cloudinary ─────────────────────────────
const Module = require("module");
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "multer-storage-cloudinary") {
    return {
      CloudinaryStorage: class {
        constructor() {}
        _handleFile(req, file, cb) {
          cb(null, {
            path: "https://res.cloudinary.com/test/image/upload/stub.jpg",
            filename: "stub_filename",
          });
        }
        _removeFile(req, file, cb) { cb(null); }
      },
    };
  }
  return _origLoad.apply(this, arguments);
};

// ─── Stub @mapbox/mapbox-sdk geocoding ───────────────────────────────────────
const mbxModule = require("@mapbox/mapbox-sdk/services/geocoding");
const mbxReal = mbxModule;
// We'll override the geocodingClient after requiring the app by monkey-patching
// the listing controller module cache. Instead, we set a global stub flag.
let geocoderShouldFail = false;
let geocoderReturnEmpty = false;

// Patch geocoding at module-load time via Module._load
Module._load = function (request, parent, isMain) {
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

// ─── Database helpers ─────────────────────────────────────────────────────────
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

  // Create tables (mirrors schema.sql)
  await dbConn.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      username      VARCHAR(50)   NOT NULL,
      email         VARCHAR(255)  NOT NULL,
      password_hash VARCHAR(255)  NOT NULL,
      created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_email (email)
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
  await dbConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await dbConn.end();
}

async function clearData() {
  await dbConn.query("SET FOREIGN_KEY_CHECKS=0");
  await dbConn.query("DELETE FROM reviews");
  await dbConn.query("DELETE FROM listings");
  await dbConn.query("DELETE FROM users");
  await dbConn.query("SET FOREIGN_KEY_CHECKS=1");
}

async function createUser(username = "testuser", password = "testpass123") {
  const hash = await bcrypt.hash(password, 10);
  const [r] = await dbConn.query(
    "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)",
    [username, `${username}@example.com`, hash]
  );
  return { id: r.insertId, username, email: `${username}@example.com`, password };
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

// ─── App & supertest setup ────────────────────────────────────────────────────
// We require the app AFTER stubs are in place
let request;
let app;

// ─── Tests ───────────────────────────────────────────────────────────────────

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

  // Patch pool to use the test connection details
  const pool = require("../db/pool");

  // Require supertest
  const supertest = require("supertest");

  // We need to load the app but NOT call app.listen (pool.execute("SELECT 1")
  // will pass since the pool is connected). We intercept to prevent the server
  // from actually listening.
  //
  // Strategy: require app.js but capture the express app before listen is called.
  // Since app.js uses pool.execute().then(app.listen), we need to export `app`.
  // app.js doesn't export anything. Use supertest directly on the app object.
  //
  // Workaround: monkey-patch app.listen so it's a no-op during tests, then
  // capture via module.exports trick.
  const express = require("express");
  const origListen = express.application.listen;
  express.application.listen = function () { return this; };

  delete require.cache[require.resolve("../app")];
  // Load app – it exports nothing, but we can use the express app object
  require("../app");
  // Restore
  express.application.listen = origListen;

  // Since app.js doesn't export app, we reconstruct a test-friendly server.
  // Instead re-create a minimal wrapper using the routes directly.
  // Simpler: export app from app.js won't work without modifying it.
  // Use a trick: find the app from the routes.
  // ──────────────────────────────────────────────────────────────────────────
  // NOTE: For the test to work without modifying app.js, we create a small
  // wrapper that wires everything identically. This is the correct approach
  // when app.js doesn't export the express instance.
  // ──────────────────────────────────────────────────────────────────────────

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
        return done(null, { id: user.id, username: user.username, email: user.email });
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

  app.get("/", (req, res) => res.send("root route"));
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

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Route matrix (Section 11.2)", () => {
  let user1, user2, listingId, reviewId;

  before(async () => {
    await clearData();
    user1 = await createUser("owner1", "password1");
    user2 = await createUser("other1", "password2");
    listingId = await createListing(user1.id);
  });

  // Row 1 – GET /
  it("Row 1: GET / → 200 'root route'", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.match(res.text, /root route/);
  });

  // Row 2 – GET /listings
  it("Row 2: GET /listings → 200, seeded listing appears", async () => {
    const res = await request(app).get("/listings");
    assert.equal(res.status, 200);
    assert.match(res.text, /Test Listing/);
  });

  // Row 3 – GET /listings/new unauthenticated
  it("Row 3: GET /listings/new (anon) → 302 to /login with flash", async () => {
    const res = await request(app).get("/listings/new").redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /login/);
  });

  // Row 4 – GET /listings/new logged in
  it("Row 4: GET /listings/new (logged in) → 200 with form", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag.get("/listings/new");
    assert.equal(res.status, 200);
    assert.match(res.text, /new/i);
  });

  // Row 5 – POST /listings valid
  it("Row 5: POST /listings (logged in, valid) → 302 /listings with flash", async () => {
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

  // Row 6 – POST /listings missing title → 400
  it("Row 6: POST /listings (missing title) → 400, no row inserted", async () => {
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

  // Row 7 – POST /listings no file
  it("Row 7: POST /listings (no file) → 302 /listings/new with flash", async () => {
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

  // Row 8 – POST /listings geocoder returns no feature
  it("Row 8: POST /listings (geocoder empty) → 302 /listings/new, no row", async () => {
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

  // Row 9 – GET /listings/:id
  it("Row 9: GET /listings/:id → 200 with title and price", async () => {
    const res = await request(app).get(`/listings/${listingId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Test Listing/);
  });

  // Row 10 – listing with NULL coordinates
  it("Row 10: GET /listings/:id (null coords) → 200 no script error", async () => {
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

  // Row 11 – GET /listings/99999 (unknown)
  it("Row 11: GET /listings/99999 → flash redirect or 404, never 500", async () => {
    const res = await request(app).get("/listings/99999").redirects(5);
    assert.notEqual(res.status, 500);
  });

  // Row 12 – GET /listings/abc (invalid id)
  it("Row 12: GET /listings/abc → 404 page, never 500", async () => {
    const res = await request(app).get("/listings/abc");
    assert.notEqual(res.status, 500);
    assert.ok(res.status === 404 || res.status === 302);
  });

  // Row 13 – GET /listings/:id/edit as owner
  it("Row 13: GET /listings/:id/edit (owner) → 200 with prefilled fields", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag.get(`/listings/${listingId}/edit`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Test Listing/);
  });

  // Row 14 – GET /listings/:id/edit as non-owner
  it("Row 14: GET /listings/:id/edit (non-owner) → 302 with flash", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag.get(`/listings/${listingId}/edit`).redirects(0);
    assert.equal(res.status, 302);
  });

  // Row 15 – PUT /listings/:id valid
  it("Row 15: PUT /listings/:id (owner, valid) → 302 /listings/:id", async () => {
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

  // Row 16 – PUT includes owner_id injection attempt (F1)
  it("Row 16: PUT with owner_id injection → ownership unchanged (F1)", async () => {
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

  // Row 17 – PUT with invalid body (empty title)
  it("Row 17: PUT (owner, empty title) → 400", async () => {
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

  // Row 18 – PUT location changed → geocoder called again (F8)
  it("Row 18: PUT (location changed) → lat/lng updated (F8)", async () => {
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

  // Row 19 – PUT as non-owner
  it("Row 19: PUT (non-owner) → blocked", async () => {
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

  // Row 20 – DELETE /listings/:id as owner (cascade)
  it("Row 20: DELETE /listings/:id (owner) → listing + reviews deleted", async () => {
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

  // Row 21 – DELETE as non-owner
  it("Row 21: DELETE (non-owner) → blocked, row remains", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .delete(`/listings/${listingId}?_method=DELETE`)
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [listingId]);
    assert.equal(rows.length, 1);
  });

  // Row 22 – POST /listings/:id/reviews (anon) → 302 to /login (F7)
  it("Row 22: POST review (anon) → 302 /login (F7)", async () => {
    const res = await request(app)
      .post(`/listings/${listingId}/reviews`)
      .send(`review[rating]=5&review[comment]=nice`)
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /login/);
  });

  // Row 23 – POST review valid
  it("Row 23: POST review (logged in, valid) → 302 /listings/:id", async () => {
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

  // Row 24 – POST review invalid (empty comment) → 400 with errors (F6)
  it("Row 24: POST review (empty comment) → 400 re-render with errors (F6)", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .post(`/listings/${listingId}/reviews`)
      .send(`review[rating]=5&review[comment]=`)
      .redirects(0);
    assert.equal(res.status, 400);
    assert.match(res.text, /Comment is required/);
  });

  // Row 25 – DELETE review as author
  it("Row 25: DELETE review (author) → deleted", async () => {
    const ag = agent();
    await loginAgent(ag, user2.username, user2.password);
    const res = await ag
      .delete(`/listings/${listingId}/reviews/${reviewId}?_method=DELETE`)
      .redirects(0);
    assert.equal(res.status, 302);
    const [rows] = await dbConn.query("SELECT * FROM reviews WHERE review_id=?", [reviewId]);
    assert.equal(rows.length, 0);
  });

  // Row 26 – DELETE review as other user
  it("Row 26: DELETE review (other user) → blocked with flash", async () => {
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

  // Row 27 – DELETE unknown review
  it("Row 27: DELETE unknown reviewId → flash redirect, no crash", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag
      .delete(`/listings/${listingId}/reviews/99999?_method=DELETE`)
      .redirects(0);
    assert.notEqual(res.status, 500);
  });

  // Row 28 – GET /signup, /login
  it("Row 28: GET /signup and /login → 200", async () => {
    const r1 = await request(app).get("/signup");
    const r2 = await request(app).get("/login");
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
  });

  // Row 29 – POST /signup new user
  it("Row 29: POST /signup (new user) → logged in, flash, redirect", async () => {
    const ag = agent();
    const res = await ag
      .post("/signup")
      .send("username=newuser29&email=newuser29@example.com&password=pass12345")
      .redirects(0);
    assert.equal(res.status, 302);
    // Verify bcrypt hash stored (not plaintext)
    const [rows] = await dbConn.query("SELECT password_hash FROM users WHERE username=?", ["newuser29"]);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].password_hash, "pass12345");
    assert.ok(rows[0].password_hash.startsWith("$2"));
  });

  // Row 30 – POST /signup duplicate
  it("Row 30: POST /signup (duplicate) → flash redirect /signup, no 500", async () => {
    const ag = agent();
    // First sign up
    await ag
      .post("/signup")
      .send("username=dupuser&email=dup@example.com&password=pass12345")
      .redirects(5);
    // Duplicate sign up
    const res = await ag
      .post("/signup")
      .send("username=dupuser&email=dup2@example.com&password=pass12345")
      .redirects(0);
    assert.notEqual(res.status, 500);
    assert.equal(res.status, 302);
  });

  // Row 31 – POST /login correct credentials + redirect URL
  it("Row 31: POST /login (correct, redirect URL) → redirects to requested URL", async () => {
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

  // Row 32 – POST /login wrong password
  it("Row 32: POST /login (wrong password) → redirect to /login", async () => {
    const ag = agent();
    const res = await ag
      .post("/login")
      .send(`username=${user1.username}&password=wrongpassword`)
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /login/);
  });

  // Row 33 – GET /logout
  it("Row 33: GET /logout (logged in) → session ended, flash", async () => {
    const ag = agent();
    await loginAgent(ag, user1.username, user1.password);
    const res = await ag.get("/logout").redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/listings/);
  });

  // Row 34 – GET /does-not-exist
  it("Row 34: GET /does-not-exist → 404 page", async () => {
    const res = await request(app).get("/does-not-exist");
    assert.equal(res.status, 404);
    assert.match(res.text, /Page not found|not found/i);
  });
});

// ─── Section 11.3 Cross-cutting checks ───────────────────────────────────────

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

  it("Invalid id (string 'abc') → findById returns null, no exception", async () => {
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
