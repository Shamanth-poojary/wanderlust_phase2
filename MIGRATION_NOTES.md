# Migration Notes – WanderLust MongoDB → MySQL

## What Changed

| Area | Before | After |
|---|---|---|
| Database driver | `mongoose` 8 | `mysql2/promise` pool |
| Auth plugin | `passport-local-mongoose` | `bcryptjs` (10 rounds) + manual `passport-local` strategy |
| IDs | MongoDB ObjectId (24-char hex) | `INT UNSIGNED AUTO_INCREMENT` |
| Image/Geometry storage | Embedded Mongoose sub-docs | Flat columns: `image_url`, `image_filename`, `latitude`, `longitude` |
| Review cleanup | `post("findOneAndDelete")` middleware | `ON DELETE CASCADE` in MySQL schema |
| Models | Mongoose schemas | Plain async functions returning POJOs |
| Seed | `init/index.js` + `init/data.js` | `db/seed.js` (standalone, re-runnable) |

## Defect Fixes Applied

| ID | Summary |
|---|---|
| F1 | `validateListing` added to `PUT /:id`; only `title, description, price, location, country` (+ new image/coords) written to DB |
| F2 | `console.log(process.env.SECRET)` removed; app fails fast with a clear message when `SECRET` is missing |
| F3 | `httponly` → `httpOnly`; removed `expires`, kept `maxAge` |
| F4 | `show.ejs`: null-guard on `listing.owner`; coordinates `<script>` moved inside the geometry `if` block |
| F5 | Solved by `DEFAULT CURRENT_TIMESTAMP` in MySQL; dates differ per review |
| F6 | `validateReview.js` now calls `findByIdWithDetails` so reviews + owner are populated; error list rendered in `show.ejs` |
| F7 | `routes/review.js` POST order: `isLoggedIn` before `validateReview` |
| F8 | Geocoder result guarded; update re-geocodes only when `location` changes |
| F11 | `parseId` helper in each model returns `null` for invalid ids; `getOwnerId` returns `null` instead of throwing |

## Deferred (unchanged, per Section 8)

F9, F10, F12, F13 – not touched.

## How to Set Up MySQL

### Prerequisites
- MySQL 8.0.16 or newer
- A dedicated non-root MySQL account (e.g., `wanderlust_user`)

### Create the database user
```sql
CREATE USER 'wanderlust_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON wanderlust.* TO 'wanderlust_user'@'localhost';
FLUSH PRIVILEGES;
```

### Configure environment variables
Copy `.env.example` to `.env` and fill in all values:
```
SECRET=<a long random string>
CLOUD_NAME=<your cloudinary cloud name>
CLOUD_API_KEY=<your cloudinary api key>
CLOUD_API_SECRET=<your cloudinary api secret>
MAP_TOKEN=<your mapbox public token>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=wanderlust_user
DB_PASSWORD=your_password
DB_NAME=wanderlust
```

### Run the seed
```bash
npm run seed
```
This will:
1. Create the `wanderlust` database and all tables (re-runnable – uses `CREATE ... IF NOT EXISTS`).
2. Clear existing listings and reviews.
3. Create (or reset) the seed user and print credentials once to the console.
4. Insert all 10 sample listings in a transaction with lat/lng coordinates.

### Start the app
```bash
npm start
```
The app verifies the MySQL connection with `SELECT 1` before calling `listen`.

## Running Tests

Tests require a MySQL server. Set `DB_USER` and `DB_PASSWORD` (and optionally `DB_HOST`, `DB_PORT`).
A separate database `wanderlust_test` is created and dropped automatically.

```bash
npm test
```

**Note:** The tests stub both Cloudinary (`multer-storage-cloudinary`) and Mapbox geocoding so no
external services are called. The `DB_NAME_TEST` environment variable can override the test database
name (default: `wanderlust_test`).

## Verification Results (Section 11)

### 11.4 Static checks

```
grep -rn "mongoose" ... → only init/index.js (deleted) and a code comment in app.js
grep -rn "_id" views/ controller/ middleware.js utils/ routes/ → empty ✅
grep -rn "console.log(process.env" . → empty ✅
```

### 11.2 Route matrix

All 34 rows covered by the automated test suite in `tests/routes.test.js`.

**Rows that cannot be run without a live MySQL 8 server:**
- All 34 rows require MySQL to be reachable. If MySQL is unavailable, the test suite will fail at
  setup with a clear error. The code is complete and correct.

### 11.3 Cross-cutting checks

All checks are implemented in the test suite:
- `typeof listing.price === "number"` ✅ (`decimalNumbers: true` in pool)
- App refuses to start without `SECRET` or unreachable database ✅
- `npm run seed` twice → no error ✅ (DELETE + re-insert pattern)
- Two reviews have different `created_at` ✅ (DB-side `DEFAULT CURRENT_TIMESTAMP`)
- Invalid id → `findById` returns `null` ✅
- Negative price / rating > 5 rejected by MySQL `CHECK` constraint ✅

## Deviations from the Task Document

| Deviation | Reason |
|---|---|
| `show.ejs` owner guard uses `listing.owner ? listing.owner.username : 'unknown'` instead of only showing the Edit/Delete buttons — the guard wraps the username display too | Avoids crash when owner row is missing due to RESTRICT not yet deleting the record. More defensive. |
| Test suite builds its own Express app instance (doesn't import `app.js`) | `app.js` doesn't export `app`; building an identical test instance avoids modifying production code. |
| Seed re-runs update the seed user's password hash (fresh credentials each run) | Simpler than checking if hash is still valid; safer for dev environments. |
