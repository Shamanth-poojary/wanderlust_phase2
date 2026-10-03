/**
 * db/migrate.js
 * Idempotent migration: adds the role column, admin_flag generated column,
 * and uq_single_admin unique index to an existing wanderlust database.
 *
 * Usage: node db/migrate.js   (or: npm run migrate)
 *
 * Safe to run more than once; each step is guarded by an information_schema check.
 */

"use strict";

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const mysql = require("mysql2/promise");

async function migrate() {
  const dbName = process.env.DB_NAME || "wanderlust";

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || "127.0.0.1",
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
    multipleStatements: false,
  });

  try {
    // Step 1: add role column if missing
    const [roleRows] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
      [dbName]
    );

    let roleColumnAdded = false;
    if (roleRows.length === 0) {
      await conn.query(
        `ALTER TABLE users
         ADD COLUMN role ENUM('customer','owner','admin') NOT NULL DEFAULT 'customer'
         AFTER password_hash`
      );
      console.log("Step 1: Added 'role' column to users.");
      roleColumnAdded = true;
    } else {
      console.log("Step 1: 'role' column already exists - skipped.");
    }

    // Step 2: only in the run that added the column, promote owners
    if (roleColumnAdded) {
      await conn.query(
        `UPDATE users SET role = 'owner'
         WHERE user_id IN (SELECT DISTINCT owner_id FROM listings)`
      );
      console.log("Step 2: Set role='owner' for users who own at least one listing.");
    } else {
      console.log("Step 2: role column was pre-existing - owner backfill skipped.");
    }

    // Step 3: add admin_flag generated column if missing
    const [flagRows] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'admin_flag'`,
      [dbName]
    );

    if (flagRows.length === 0) {
      await conn.query(
        `ALTER TABLE users
         ADD COLUMN admin_flag TINYINT GENERATED ALWAYS AS (IF(role = 'admin', 1, NULL)) STORED`
      );
      console.log("Step 3: Added 'admin_flag' generated column to users.");
    } else {
      console.log("Step 3: 'admin_flag' column already exists - skipped.");
    }

    // Step 4: add uq_single_admin unique index if missing
    const [idxRows] = await conn.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'uq_single_admin'`,
      [dbName]
    );

    if (idxRows.length === 0) {
      await conn.query(
        `ALTER TABLE users ADD UNIQUE KEY uq_single_admin (admin_flag)`
      );
      console.log("Step 4: Added unique index 'uq_single_admin' on admin_flag.");
    } else {
      console.log("Step 4: Unique index 'uq_single_admin' already exists - skipped.");
    }

    console.log("Migration complete.");
  } finally {
    await conn.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
