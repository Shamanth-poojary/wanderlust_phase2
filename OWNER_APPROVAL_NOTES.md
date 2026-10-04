# Phase 2 Step 3: Owner Approval and Role-Based Listing Rights

## 1. Summary of Changes
- Introduced owner profile verification system (`pending`, `approved`, `rejected`, and derived `none`).
- Added database table `owner_profile` linked via foreign key to `users(user_id)`.
- Implemented migrations (Step 5: table creation; Step 6: grandfathering existing owners who have listings).
- Updated user models to load verification status (`ownerStatus`) via LEFT JOIN.
- Created `OwnerProfile` model with parameterized queries.
- Extended user signup flow to accept business details (`business_name`, `business_type`, `phone`) in an atomic transaction when registering as `owner`. Customer registrations strip these fields.
- Implemented role-based listing permissions (`isApprovedOwner` middleware) placed before file upload (`upload.single("image")`) to prevent unauthorized uploads.
- Built owner status and re-application interface at `/owner/status` and `POST /owner/application`.
- Built admin management interface at `/admin/owners` with approval and rejection actions and status tab counts.
- Hardened session cookies with `sameSite: "lax"` and `httpOnly: true`.
- Updated navigation and listing views to show actions only to authorized roles.

## 2. Schema and Migration Additions
- Database table `owner_profile`:
  - `owner_id`: INT UNSIGNED PRIMARY KEY, FOREIGN KEY to `users(user_id)` ON DELETE CASCADE.
  - `business_name`: VARCHAR(100) NOT NULL.
  - `business_type`: ENUM('hotel_owner','property_owner','venue_owner','event_planner') NOT NULL.
  - `phone`: VARCHAR(20) NULL.
  - `verification_status`: ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'.
  - `rejection_reason`: VARCHAR(500) NULL.
  - `verified_at`: TIMESTAMP NULL.
  - `created_at`, `updated_at`: TIMESTAMP.
  - Index: `idx_owner_profile_status (verification_status)`.
- Migration:
  - Step 5 creates `owner_profile` table if not exists.
  - Step 6 grandfathers existing owners who have listings by inserting an approved profile row with `NOW()` as `verified_at`.

## 3. Owner Lifecycle and Permission Matrix
- Status values:
  - `none`: Role is owner, but no record exists in `owner_profile`.
  - `pending`: Application submitted, waiting for admin approval.
  - `approved`: Admin approved or grandfathered; full listing privileges.
  - `rejected`: Admin rejected; may view reason and submit a new application.
- Permissions:
  - Public viewing (`GET /listings`, `GET /listings/:id`): open to all (anonymous, customer, owner, admin).
  - Create listing (`GET /listings/new`, `POST /listings`): only approved owners. Others redirected with exact flash messages per specification.
  - Edit/Delete listing: only approved owners who own that listing (`isApprovedOwner` + `isOwner`).
  - File upload protection: `isApprovedOwner` runs before `upload.single("image")`, ensuring Cloudinary uploads are never triggered for unauthorized users.

## 4. Admin Approval Workflow and URL Layout
- `GET /admin/owners`: lists owner applications with filter tabs for `pending`, `approved`, `rejected`, and `all`. Filter defaults to `pending`.
- `POST /admin/owners/:userId/approve`: sets status to `approved`, stamps `verified_at = NOW()`, clears rejection reason.
- `POST /admin/owners/:userId/reject`: sets status to `rejected`, stores optional trimmed reason (max 500 characters).
- Security: protected with `requireRole("admin")`. Invalid user IDs or non-owner targets return `Owner application not found` error flash without 500 crashes.

## 5. Session Cookie Hardening
- Session cookie configuration updated to include `sameSite: "lax"` alongside `httpOnly: true`.
- Rationale: protects authenticated sessions from Cross-Site Request Forgery (CSRF) on cross-origin requests while preserving standard top-level navigation behavior.

## 6. Test Coverage Summary
- Total tests: 145 tests across 20 suites.
- Execution command: `npm test` (runs `node --test tests/routes.test.js`).
- Results: All 145 tests pass (0 failures, 0 skipped).
- Covered areas:
  - Listing permission matrix across all 6 roles/states.
  - File upload bypass prevention.
  - Owner signup atomic transactions and field validation.
  - Owner status view and re-application workflow.
  - Admin owner list, filtering, approval, rejection, and bounds checking.
  - UI role-conditional navigation, buttons, and badges.
  - Migration grandfathering and idempotence.
  - Session cookie security attributes.
  - Existing review and route regressions.

## 7. Known Limitations and Follow-ups
- Admin notifications: currently admin count badge polls on page render; real-time webhooks or email alerts can be added in future phases.
- Rate limiting: re-application form does not enforce a cooldown period between repeated re-applications.
- Pagination: admin owner table currently displays all records matching the filter; pagination can be introduced if owner volume scales.

## 8. Running Migration and Seed
- To run migration: `npm run migrate` (runs `node db/migrate.js`, executing schema updates and grandfathering idempotently).
- To seed the database: `npm run seed` (runs `node db/seed.js`, creating tables, admin user, approved seed owner, and sample listings).
- Deviations from specification: None. All requirements, matrix cases, URLs, and flash messages match specification exactly.

