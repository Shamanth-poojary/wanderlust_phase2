/**
 * db/seed.js – re-runnable seed script.
 * Usage: node db/seed.js   (or: npm run seed)
 *
 * 1. Applies schema.sql (creates DB + tables).
 * 2. Clears reviews and listings (RESTRICT keeps users safe; we clear explicitly).
 * 3. Creates (or reuses) the seed user.
 * 4. Inserts all 10 sample listings in one transaction.
 */

"use strict";

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const { ensureAdmin } = require("./ensureAdmin");

// ─── Sample data (from init/data.js) ────────────────────────────────────────
const sampleListings = [
  {
    title: "Cozy Beachfront Cottage",
    description:
      "Escape to this charming beachfront cottage for a relaxing getaway. Enjoy stunning ocean views and easy access to the beach.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1552733407-5d5c46c3bb3b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 1500,
    location: "Malibu",
    country: "United States",
    geometry: { type: "Point", coordinates: [-118.7798, 34.0259] },
  },
  {
    title: "Modern Loft in Downtown",
    description:
      "Stay in the heart of the city in this stylish loft apartment. Perfect for urban explorers!",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 1200,
    location: "New York City",
    country: "United States",
    geometry: { type: "Point", coordinates: [-74.006, 40.7128] },
  },
  {
    title: "Mountain Retreat",
    description:
      "Unplug and unwind in this peaceful mountain cabin. Surrounded by nature, it's a perfect place to recharge.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 1000,
    location: "Aspen",
    country: "United States",
    geometry: { type: "Point", coordinates: [-106.8175, 39.1911] },
  },
  {
    title: "Historic Villa in Tuscany",
    description:
      "Experience the charm of Tuscany in this beautifully restored villa. Explore the rolling hills and vineyards.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 2500,
    location: "Florence",
    country: "Italy",
    geometry: { type: "Point", coordinates: [11.2558, 43.7696] },
  },
  {
    title: "Secluded Treehouse Getaway",
    description:
      "Live among the treetops in this unique treehouse retreat. A true nature lover's paradise.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 800,
    location: "Portland",
    country: "United States",
    geometry: { type: "Point", coordinates: [-122.6765, 45.5231] },
  },
  {
    title: "Beachfront Paradise",
    description:
      "Step out of your door onto the sandy beach. This beachfront condo offers the ultimate relaxation.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 2000,
    location: "Cancun",
    country: "Mexico",
    geometry: { type: "Point", coordinates: [-86.8515, 21.1619] },
  },
  {
    title: "Rustic Cabin by the Lake",
    description:
      "Spend your days fishing and kayaking on the serene lake. This cozy cabin is perfect for outdoor enthusiasts.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 900,
    location: "Lake Tahoe",
    country: "United States",
    geometry: { type: "Point", coordinates: [-120.0324, 39.0968] },
  },
  {
    title: "Luxury Penthouse with City Views",
    description:
      "Indulge in luxury living with panoramic city views from this stunning penthouse apartment.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1622396481328-9b1b78cdd9fd?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 3500,
    location: "Los Angeles",
    country: "United States",
    geometry: { type: "Point", coordinates: [-118.2437, 34.0522] },
  },
  {
    title: "Ski-In/Ski-Out Chalet",
    description:
      "Hit the slopes right from your doorstep in this ski-in/ski-out chalet in the Swiss Alps.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1502784444187-359ac186c5bb?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 3000,
    location: "Verbier",
    country: "Switzerland",
    geometry: { type: "Point", coordinates: [7.2286, 46.096] },
  },
  {
    title: "Safari Lodge in the Serengeti",
    description:
      "Experience the thrill of the wild in a comfortable safari lodge. Witness the Great Migration up close.",
    image: {
      filename: "listingimage",
      url: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60",
    },
    price: 4000,
    location: "Serengeti National Park",
    country: "Tanzania",
    geometry: { type: "Point", coordinates: [34.6857, -2.3333] },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function applySchema(conn) {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  // Split on ";" and run each non-empty statement.
  // Skip CREATE DATABASE and USE statements — we are already connected
  // to the target database and the user may lack global CREATE privilege.
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^\s*(CREATE DATABASE|USE)\b/i.test(s));

  for (const stmt of statements) {
    await conn.query(stmt);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  // Connect directly to the wanderlust database.
  // wanderlust_user has ALL PRIVILEGES on wanderlust.* but no global CREATE DATABASE.
  // The schema.sql uses CREATE DATABASE IF NOT EXISTS + USE, which are skipped gracefully
  // when the DB already exists and is already selected.
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "wanderlust",
    multipleStatements: false,
  });

  try {
    console.log("Applying schema…");
    await applySchema(conn);

    // ── Clear existing listings & reviews (users preserved) ───────────────
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query("DELETE FROM reviews");
    await conn.query("DELETE FROM listings");
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");

    // ── Upsert seed user ──────────────────────────────────────────────────
    const seedUsername = "seeduser";
    const rawPassword = Math.random().toString(36).slice(-12);
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const [existing] = await conn.query(
      "SELECT user_id FROM users WHERE username = ? LIMIT 1",
      [seedUsername]
    );

    let seedUserId;
    if (existing.length > 0) {
      // Update hash and ensure role='owner' on re-runs
      seedUserId = existing[0].user_id;
      await conn.query(
        "UPDATE users SET password_hash = ?, role = 'owner' WHERE username = ?",
        [passwordHash, seedUsername]
      );
      console.log(`Seed user already exists (id=${seedUserId}), password and role reset.`);
    } else {
      const [result] = await conn.query(
        "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'owner')",
        [seedUsername, "seeduser@example.com", passwordHash]
      );
      seedUserId = result.insertId;
      console.log(`Seed user created (id=${seedUserId}).`);
    }

    // Print credentials ONCE so the developer can log in
    console.log(`\n  Seed user credentials:`);
    console.log(`    username : ${seedUsername}`);
    console.log(`    password : ${rawPassword}`);
    console.log();

    // ── Insert listings in a transaction ─────────────────────────────────
    await conn.beginTransaction();
    try {
      for (const listing of sampleListings) {
        const longitude = listing.geometry.coordinates[0];
        const latitude = listing.geometry.coordinates[1];

        await conn.query(
          `INSERT INTO listings
             (owner_id, title, description, price, location, country,
              image_url, image_filename, latitude, longitude)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            seedUserId,
            listing.title,
            listing.description,
            listing.price,
            listing.location,
            listing.country,
            listing.image.url,
            listing.image.filename,
            latitude,
            longitude,
          ]
        );
      }
      await conn.commit();
      console.log(`Inserted ${sampleListings.length} listings.`);
    } catch (err) {
      await conn.rollback();
      throw err;
    }

    // Bootstrap admin using the seed connection
    const adminStatus = await ensureAdmin(conn);
    console.log("Admin bootstrap status:", adminStatus);

    console.log("Seed complete.");
  } finally {
    await conn.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
