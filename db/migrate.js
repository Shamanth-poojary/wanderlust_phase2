/**
 * db/migrate.js
 * Idempotent migration: adds role column, admin_flag, uq_single_admin,
 * and the owner_profile table to an existing wanderlust database.
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

    // Step 5: create owner_profile table if missing
    const [tblRows] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'owner_profile'`,
      [dbName]
    );

    if (tblRows.length === 0) {
      await conn.query(`
        CREATE TABLE owner_profile (
          owner_id            INT UNSIGNED NOT NULL,
          business_name       VARCHAR(100) NOT NULL,
          business_type       ENUM('hotel_owner','property_owner','venue_owner','event_planner') NOT NULL,
          phone               VARCHAR(20)  NULL,
          verification_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
          rejection_reason    VARCHAR(500) NULL,
          verified_at         TIMESTAMP    NULL,
          created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (owner_id),
          CONSTRAINT fk_owner_profile_user FOREIGN KEY (owner_id)
            REFERENCES users (user_id) ON DELETE CASCADE,
          KEY idx_owner_profile_status (verification_status)
        ) ENGINE=InnoDB
      `);
      console.log("Step 5: Created 'owner_profile' table.");
    } else {
      console.log("Step 5: 'owner_profile' table already exists - skipped.");
    }

    // Step 6: grandfather existing owners with listings (approved profile)
    // Uses INSERT ... SELECT ... WHERE NOT EXISTS so a second run inserts nothing
    await conn.query(`
      INSERT INTO owner_profile (owner_id, business_name, business_type, phone, verification_status, verified_at)
      SELECT u.user_id, u.username, 'property_owner', NULL, 'approved', NOW()
      FROM users u
      WHERE u.role = 'owner'
        AND EXISTS (SELECT 1 FROM listings l WHERE l.owner_id = u.user_id)
        AND NOT EXISTS (SELECT 1 FROM owner_profile op WHERE op.owner_id = u.user_id)
    `);
    const [countRows] = await conn.query(
      `SELECT COUNT(*) AS c FROM owner_profile WHERE verification_status = 'approved'`
    );
    console.log(
      `Step 6: Grandfathered owners with listings (approved profiles: ${countRows[0].c} total).`
    );

    console.log("Migration complete.");
  } finally {
    await conn.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
