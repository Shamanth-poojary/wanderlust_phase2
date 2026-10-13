/**
 * tests/dashboard_phase4.test.js
 * Comprehensive automated test suite for Phase 4: Role-Based User Dashboard.
 */

"use strict";

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { ensureAdmin } = require("../db/ensureAdmin");

module.exports = function runPhase4DashboardTests(getFixtures) {
  describe("Phase 4: Role-Based User Dashboard", { concurrency: 1 }, () => {
    let app, request, dbConn, agent, loginAgent, createUser, createOwnerWithProfile, createListing, clearData;

    before(() => {
      const fixtures = typeof getFixtures === "function" ? getFixtures() : getFixtures;
      app = fixtures.app;
      request = fixtures.request;
      dbConn = fixtures.dbConn;
      agent = fixtures.agent;
      loginAgent = fixtures.loginAgent;
      createUser = fixtures.createUser;
      createOwnerWithProfile = fixtures.createOwnerWithProfile;
      createListing = fixtures.createListing;
      clearData = fixtures.clearData;
    });

    // Helper: get admin user
    async function getAdminUser() {
      process.env.ADMIN_USERNAME = "p4_admin";
      process.env.ADMIN_EMAIL    = "p4_admin@example.com";
      process.env.ADMIN_PASSWORD = "p4adminpass123";
      await ensureAdmin(dbConn);
      const [rows] = await dbConn.query("SELECT * FROM users WHERE role='admin' LIMIT 1");
      return { id: rows[0].user_id, username: rows[0].username, password: process.env.ADMIN_PASSWORD, role: "admin" };
    }

    // -------------------------------------------------------------------------
    // 1. Dashboard entry & Role routing (/dashboard)
    // -------------------------------------------------------------------------
    describe("1. Dashboard entry & routing", () => {
      it("Anonymous user GET /dashboard -> redirects to /login", async () => {
        const res = await request(app).get("/dashboard").redirects(0);
        assert.equal(res.status, 302);
        assert.match(res.headers.location, /\/login/);
      });

      it("Customer GET /dashboard -> redirects to /dashboard/wishlist", async () => {
        await clearData();
        const cust = await createUser("dash_cust", "pass", "customer");
        const ag = agent();
        await ag.post("/login").send("username=dash_cust&password=pass");

        const res = await ag.get("/dashboard").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/dashboard/wishlist");
      });

      it("Owner GET /dashboard -> redirects to /dashboard/listings", async () => {
        await clearData();
        const owner = await createOwnerWithProfile("dash_owner", "pass", "approved");
        const ag = agent();
        await ag.post("/login").send("username=dash_owner&password=pass");

        const res = await ag.get("/dashboard").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/dashboard/listings");
      });

      it("Admin GET /dashboard -> redirects to /dashboard/approvals", async () => {
        await clearData();
        const adm = await getAdminUser();
        const ag = agent();
        await ag.post("/login").send(`username=${adm.username}&password=${adm.password}`);

        const res = await ag.get("/dashboard").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/dashboard/approvals");
      });
    });

    // -------------------------------------------------------------------------
    // 2. Common Profile (GET/PUT /dashboard/profile)
    // -------------------------------------------------------------------------
    describe("2. Profile Card and Edit Profile", () => {
      it("GET /dashboard/profile renders user details and sidebar sections", async () => {
        await clearData();
        const cust = await createUser("profile_user", "pass", "customer");
        const ag = agent();
        await ag.post("/login").send("username=profile_user&password=pass");

        const res = await ag.get("/dashboard/profile");
        assert.equal(res.status, 200);
        assert.match(res.text, /profile_user/);
        assert.match(res.text, /profile_user@example\.com/);
        assert.match(res.text, /Customer/);
        assert.match(res.text, /My Profile/);
        assert.match(res.text, /Wishlist/);
      });

      it("PUT /dashboard/profile successfully updates username, phone, bio", async () => {
        await clearData();
        const cust = await createUser("edit_user", "pass", "customer");
        const ag = agent();
        await ag.post("/login").send("username=edit_user&password=pass");

        const res = await ag
          .put("/dashboard/profile")
          .type("form")
          .send({
            username: "edited_user",
            phone: "+919876543210",
            bio: "Travel lover and explorer.",
          })
          .redirects(0);

        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/dashboard/profile");

        // Verify update in DB
        const [rows] = await dbConn.query("SELECT * FROM users WHERE user_id = ?", [cust.id]);
        assert.equal(rows[0].username, "edited_user");
        assert.equal(rows[0].phone, "+919876543210");
        assert.equal(rows[0].bio, "Travel lover and explorer.");
      });

      it("PUT /dashboard/profile with conflicting existing username fails with error", async () => {
        await clearData();
        const userA = await createUser("existing_a", "pass", "customer");
        const userB = await createUser("existing_b", "pass", "customer");
        const ag = agent();
        await ag.post("/login").send("username=existing_b&password=pass");

        const res = await ag
          .put("/dashboard/profile")
          .type("form")
          .send({
            username: "existing_a",
          })
          .redirects(0);

        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/dashboard/profile");

        // User B's username should NOT have changed
        const [rows] = await dbConn.query("SELECT username FROM users WHERE user_id = ?", [userB.id]);
        assert.equal(rows[0].username, "existing_b");
      });

      it("PUT /dashboard/profile with removeAvatar clears profile picture", async () => {
        await clearData();
        const cust = await createUser("pic_user", "pass", "customer");
        await dbConn.query(
          "UPDATE users SET profile_picture_url = 'https://example.com/pic.jpg', profile_picture_public_id = 'test_pid' WHERE user_id = ?",
          [cust.id]
        );

        const ag = agent();
        await ag.post("/login").send("username=pic_user&password=pass");

        const res = await ag
          .put("/dashboard/profile")
          .type("form")
          .send({
            username: "pic_user",
            removeAvatar: "true",
          })
          .redirects(0);

        assert.equal(res.status, 302);

        const [rows] = await dbConn.query("SELECT profile_picture_url, profile_picture_public_id FROM users WHERE user_id = ?", [cust.id]);
        assert.equal(rows[0].profile_picture_url, null);
        assert.equal(rows[0].profile_picture_public_id, null);
      });
    });

    // -------------------------------------------------------------------------
    // 3. Customer Wishlist & Extensible sections
    // -------------------------------------------------------------------------
    describe("3. Wishlist Feature", () => {
      it("Customer can add and remove a listing via AJAX and view it in /dashboard/wishlist", async () => {
        await clearData();
        const owner = await createOwnerWithProfile("w_owner", "pass", "approved");
        const listingId = await createListing(owner.id);
        const cust = await createUser("w_cust", "pass", "customer");

        const ag = agent();
        await ag.post("/login").send("username=w_cust&password=pass");

        // 1. Add to wishlist
        const addRes = await ag
          .post(`/wishlist/${listingId}`)
          .set("Accept", "application/json");
        assert.equal(addRes.status, 200);
        assert.equal(addRes.body.success, true);
        assert.equal(addRes.body.wishlisted, true);

        // Verify DB
        const [wRows] = await dbConn.query(
          "SELECT * FROM wishlists WHERE user_id = ? AND listing_id = ?",
          [cust.id, listingId]
        );
        assert.equal(wRows.length, 1);

        // 2. View in /dashboard/wishlist
        const viewRes = await ag.get("/dashboard/wishlist");
        assert.equal(viewRes.status, 200);
        assert.match(viewRes.text, /My Wishlist/);
        assert.match(viewRes.text, /Test Listing/);

        // 3. Remove from wishlist
        const remRes = await ag
          .delete(`/wishlist/${listingId}`)
          .set("Accept", "application/json");
        assert.equal(remRes.status, 200);
        assert.equal(remRes.body.success, true);
        assert.equal(remRes.body.wishlisted, false);

        // Verify DB empty
        const [wRows2] = await dbConn.query(
          "SELECT * FROM wishlists WHERE user_id = ? AND listing_id = ?",
          [cust.id, listingId]
        );
        assert.equal(wRows2.length, 0);
      });

      it("Anonymous user cannot access /wishlist or /dashboard/wishlist -> redirects to login", async () => {
        await clearData();
        const owner = await createOwnerWithProfile("w_owner2", "pass", "approved");
        const listingId = await createListing(owner.id);

        const resWish = await request(app).get("/dashboard/wishlist").redirects(0);
        assert.equal(resWish.status, 302);
        assert.match(resWish.headers.location, /\/login/);

        const resToggle = await request(app).post(`/wishlist/${listingId}`).redirects(0);
        assert.equal(resToggle.status, 302);
        assert.match(resToggle.headers.location, /\/login/);
      });

      it("Customer can view placeholder /dashboard/bookings", async () => {
        await clearData();
        const cust = await createUser("b_cust", "pass", "customer");
        const ag = agent();
        await ag.post("/login").send("username=b_cust&password=pass");

        const res = await ag.get("/dashboard/bookings");
        assert.equal(res.status, 200);
        assert.match(res.text, /My Bookings/);
        assert.match(res.text, /Coming Soon/);
      });
    });

    // -------------------------------------------------------------------------
    // 4. Owner: My Listings
    // -------------------------------------------------------------------------
    describe("4. Owner Dashboard", () => {
      it("Approved owner sees only their listings on /dashboard/listings", async () => {
        await clearData();
        const ownerA = await createOwnerWithProfile("owner_a", "pass", "approved");
        const ownerB = await createOwnerWithProfile("owner_b", "pass", "approved");

        const lA = await createListing(ownerA.id);
        const lB = await createListing(ownerB.id);

        const ag = agent();
        await ag.post("/login").send("username=owner_a&password=pass");

        const res = await ag.get("/dashboard/listings");
        assert.equal(res.status, 200);
        assert.match(res.text, /My Listings/);
        assert.match(res.text, new RegExp(`/listings/${lA}`));
      });

      it("Pending owner sees 'Awaiting Admin Approval' notice and disabled actions", async () => {
        await clearData();
        const pendOwner = await createOwnerWithProfile("pend_owner", "pass", "pending");

        const ag = agent();
        await ag.post("/login").send("username=pend_owner&password=pass");

        const res = await ag.get("/dashboard/listings");
        assert.equal(res.status, 200);
        assert.match(res.text, /Awaiting Admin Approval/);
      });

      it("Customer cannot access /dashboard/listings -> 302 redirect", async () => {
        await clearData();
        const cust = await createUser("l_cust", "pass", "customer");
        const ag = agent();
        await ag.post("/login").send("username=l_cust&password=pass");

        const res = await ag.get("/dashboard/listings").redirects(0);
        assert.equal(res.status, 302);
      });
    });

    // -------------------------------------------------------------------------
    // 5. Admin: Owner Approvals & User Management
    // -------------------------------------------------------------------------
    describe("5. Admin Dashboard", () => {
      it("Admin can review approvals on /dashboard/approvals and approve an owner", async () => {
        await clearData();
        const adm = await getAdminUser();
        const pend = await createOwnerWithProfile("adm_pend", "pass", "pending");

        const ag = agent();
        await ag.post("/login").send(`username=${adm.username}&password=${adm.password}`);

        // 1. Approvals list
        const res = await ag.get("/dashboard/approvals");
        assert.equal(res.status, 200);
        assert.match(res.text, /adm_pend/);
        assert.match(res.text, /Pending/);

        // 2. Approve owner
        const appRes = await ag
          .post(`/dashboard/approvals/${pend.id}/approve`)
          .send("filter=pending")
          .redirects(0);
        assert.equal(appRes.status, 302);

        // Verify status in DB
        const [rows] = await dbConn.query("SELECT verification_status FROM owner_profile WHERE owner_id = ?", [pend.id]);
        assert.equal(rows[0].verification_status, "approved");
      });

      it("Admin user management: GET /dashboard/users lists users and supports search", async () => {
        await clearData();
        const adm = await getAdminUser();
        await createUser("search_alpha", "pass", "customer");
        await createUser("search_beta", "pass", "customer");

        const ag = agent();
        await ag.post("/login").send(`username=${adm.username}&password=${adm.password}`);

        // View list
        const resList = await ag.get("/dashboard/users");
        assert.equal(resList.status, 200);
        assert.match(resList.text, /search_alpha/);
        assert.match(resList.text, /search_beta/);

        // Search
        const resSearch = await ag.get("/dashboard/users?search=alpha");
        assert.equal(resSearch.status, 200);
        assert.match(resSearch.text, /search_alpha/);
        assert.doesNotMatch(resSearch.text, /search_beta/);
      });

      it("Admin user detail GET /dashboard/users/:id shows user info and owner listings", async () => {
        await clearData();
        const adm = await getAdminUser();
        const owner = await createOwnerWithProfile("detail_owner", "pass", "approved");
        const lid = await createListing(owner.id);

        const ag = agent();
        await ag.post("/login").send(`username=${adm.username}&password=${adm.password}`);

        const res = await ag.get(`/dashboard/users/${owner.id}`);
        assert.equal(res.status, 200);
        assert.match(res.text, /detail_owner/);
        assert.match(res.text, /Listings Owned/);
        assert.match(res.text, new RegExp(`/listings/${lid}`));
      });

      it("Admin can delete a user, but cannot delete main admin or self", async () => {
        await clearData();
        const adm = await getAdminUser();
        const victim = await createUser("delete_me", "pass", "customer");

        const ag = agent();
        await ag.post("/login").send(`username=${adm.username}&password=${adm.password}`);

        // 1. Delete regular user -> succeeds
        const delRes = await ag.delete(`/dashboard/users/${victim.id}`).redirects(0);
        assert.equal(delRes.status, 302);
        const [rows] = await dbConn.query("SELECT * FROM users WHERE user_id = ?", [victim.id]);
        assert.equal(rows.length, 0);

        // 2. Delete self -> blocked
        const selfRes = await ag.delete(`/dashboard/users/${adm.id}`).redirects(0);
        assert.equal(selfRes.status, 302);
        const [selfRows] = await dbConn.query("SELECT * FROM users WHERE user_id = ?", [adm.id]);
        assert.equal(selfRows.length, 1);
      });
    });
  });
};
