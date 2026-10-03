# ROLES_NOTES.md

## What changed

This document records all changes made in phase 2, step 2 (user roles and landing page).

### New files

| File | Purpose |
|---|---|
| `utils/roles.js` | Single source of truth: ROLES, SELF_REGISTER_ROLES, ROLE_LABELS |
| `utils/validateUser.js` | Joi middleware for signup validation |
| `db/ensureAdmin.js` | Idempotent admin bootstrap function |
| `db/migrate.js` | Idempotent migration for existing databases |
| `routes/landing.js` | GET / route handler |
| `views/landing.ejs` | Landing page template |
| `ROLES_NOTES.md` | This file |

### Modified files

| File | Change |
|---|---|
| `db/schema.sql` | Added role ENUM, admin_flag generated column, uq_single_admin unique index to users table |
| `db/seed.js` | Seed user gets role='owner'; ensureAdmin called after seeding |
| `models/user.js` | All functions (rowToUser, create, findByUsername, findById) now include role |
| `app.js` | Passport strategy returns role; GET / replaced with landing route; ensureAdmin called at startup |
| `controller/user.js` | renderSignup passes selectedRole; signupUser uses validated role and new flash text; logoutUser redirects to / |
| `routes/user.js` | Added validateUser middleware to POST /signup |
| `middleware.js` | Added requireRole (exported, not applied to any route) |
| `views/users/signup.ejs` | Added Account Type radio group above username field |
| `views/users/login.ejs` | Added "New here? Register" link below the form |
| `views/includes/navbar.ejs` | Shows role badge next to username when logged in |
| `package.json` | Added "migrate" script |
| `.env.example` | Added ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD variables |
| `tests/routes.test.js` | Updated rows 1, 29, 33; added R1-R26 test cases |

---

## How to set admin variables

Add the following to your local `.env` file (never commit real credentials):

```
ADMIN_USERNAME=your_admin_username
ADMIN_EMAIL=your_admin@example.com
ADMIN_PASSWORD=your_secure_password_at_least_8_chars
```

The admin account is created (or synchronised) automatically each time the app starts
and each time `npm run seed` is run. If no admin variables are set, a warning is logged
and the app continues without an admin account.

---

## How to run migration

For existing databases (created before this step), run:

```bash
npm run migrate
```

This script is idempotent: running it twice is safe and changes nothing on the second run.

---

## How to run seed

```bash
npm run seed
```

The seed script applies the schema, clears listings and reviews, upserts the seed user
(role='owner'), inserts 10 sample listings, then calls ensureAdmin to create or update
the admin account.

---

## Design decisions and deviations

| Topic | Decision |
|---|---|
| `admin_flag` in seed.js and ensureAdmin.js | Never selected or inserted from application code, only set via the GENERATED ALWAYS column |
| Seed user role | Always set to 'owner' so sample listings are owned by an 'owner' role user |
| ensureAdmin with single connection | The function accepts either a pool or a single mysql2 connection via the duck-typed `.query()` method |
| requireRole middleware | Added to middleware.js and exported but NOT applied to any route in this phase |
| Landing page styling | Bootstrap-only; no new external images or dependencies |

---

## Test results

The automated test suite (`npm test`, `node --test tests/routes.test.js`) ran against MySQL 8 and all 72 tests passed:
- Route matrix (Section 11.2): Rows 1-34 passed
- Role and landing tests (Section 11.3): R1-R26 passed (including ensureAdmin unit tests R16-R21, DB unique index R22, migration tests R23-R24)
- Cross-cutting checks: all 6 checks passed

Summary:
- tests: 72
- suites: 5
- pass: 72
- fail: 0
- cancelled: 0
- skipped: 0

---

## Static check results

```
# All ADMIN_PASSWORD references are only in .env.example and test setup:
grep -rn "ADMIN_PASSWORD" --include="*.js" . --exclude-dir=node_modules
# Should match only: tests/routes.test.js (env setup) and db/ensureAdmin.js (process.env read)

# req.body.role should only appear in utils/validateUser.js:
grep -rn "req.body.role" --include="*.js" . --exclude-dir=node_modules
# Should match only: utils/validateUser.js

# No non-ASCII characters in created/edited files:
grep -rnP "[^\x00-\x7F]" AGENT_TASK_roles_and_landing.md ROLES_NOTES.md db/ utils/ views/landing.ejs 2>/dev/null
# Should print nothing
```
