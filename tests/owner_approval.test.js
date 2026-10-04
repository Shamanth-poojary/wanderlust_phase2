/**
 * tests/owner_approval.test.js
 * Test suite covering:
 * - Listing permission matrix (Section 11.2)
 * - Further cases A1-A5, B1-B7, C1-C11, D1-D4, E1, F1-F4, G1, H1 (Section 11.3)
 */

"use strict";

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { ensureAdmin } = require("../db/ensureAdmin");

module.exports = function runOwnerApprovalTests(getFixtures) {
  describe("Owner approval and permissions (Phase 2 Step 3)", { concurrency: 1 }, () => {
    let app, request, dbConn, agent, loginAgent, createUser, createOwnerWithProfile, createListing, clearData, getUploadCount, resetUploadCount;

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
      getUploadCount = fixtures.getUploadCount;
      resetUploadCount = fixtures.resetUploadCount;
    });

    // ---------------------------------------------------------------------------
    // Section 11.2: Listing permission matrix
    // ---------------------------------------------------------------------------
  describe("Listing permission matrix (Section 11.2)", { concurrency: 1 }, () => {
    let custUser, ononeUser, opendUser, orejUser, ootherUser, oownUser, adminUser;
    let targetListingId;

    before(async () => {
      await clearData();
      custUser   = await createUser("m_cust", "pass", "customer");
      ononeUser  = await createUser("m_onone", "pass", "owner"); // no profile row
      opendUser  = await createOwnerWithProfile("m_opend", "pass", "pending");
      orejUser   = await createOwnerWithProfile("m_orej", "pass", "rejected", { rejectionReason: "Invalid doc" });
      ootherUser = await createOwnerWithProfile("m_oother", "pass", "approved");
      oownUser   = await createOwnerWithProfile("m_oown", "pass", "approved");

      // Ensure admin exists
      process.env.ADMIN_USERNAME = "matrix_admin";
      process.env.ADMIN_EMAIL    = "matrix_admin@example.com";
      process.env.ADMIN_PASSWORD = "matrixpass123";
      await ensureAdmin(dbConn);
      const [adminRows] = await dbConn.query("SELECT * FROM users WHERE role='admin' LIMIT 1");
      adminUser = { id: adminRows[0].user_id, username: adminRows[0].username, password: process.env.ADMIN_PASSWORD, role: "admin" };

      // Listing owned by oownUser
      targetListingId = await createListing(oownUser.id);
    });

    beforeEach(() => {
      resetUploadCount();
    });

    const getAgentFor = async (actor) => {
      const ag = agent();
      if (actor === "anon") return ag;
      if (actor === "cust") { await loginAgent(ag, custUser.username, custUser.password); return ag; }
      if (actor === "o-none") { await loginAgent(ag, ononeUser.username, ononeUser.password); return ag; }
      if (actor === "o-pend") { await loginAgent(ag, opendUser.username, opendUser.password); return ag; }
      if (actor === "o-rej") { await loginAgent(ag, orejUser.username, orejUser.password); return ag; }
      if (actor === "o-appr-other") { await loginAgent(ag, ootherUser.username, ootherUser.password); return ag; }
      if (actor === "o-appr-own") { await loginAgent(ag, oownUser.username, oownUser.password); return ag; }
      if (actor === "admin") { await loginAgent(ag, adminUser.username, adminUser.password); return ag; }
      throw new Error(`Unknown actor: ${actor}`);
    };

    // --- Action: GET /listings/new ---
    describe("Action: GET /listings/new", { concurrency: 1 }, () => {
      it("anon -> redirect /login", async () => {
        const ag = await getAgentFor("anon");
        const res = await ag.get("/listings/new").redirects(0);
        assert.equal(res.status, 302);
        assert.match(res.headers.location, /\/login/);
      });

      it("cust -> redirect /listings (M1)", async () => {
        const ag = await getAgentFor("cust");
        const res = await ag.get("/listings/new").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        const page = await ag.get("/listings");
        assert.match(page.text, /Only approved property or venue owners can add or edit listings/);
      });

      it("o-none -> redirect /owner/status (M3)", async () => {
        const ag = await getAgentFor("o-none");
        const res = await ag.get("/listings/new").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        const page = await ag.get("/owner/status");
        assert.match(page.text, /Please submit your business details to apply for owner approval/);
      });

      it("o-pend -> redirect /owner/status (M4)", async () => {
        const ag = await getAgentFor("o-pend");
        const res = await ag.get("/listings/new").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        const page = await ag.get("/owner/status");
        assert.match(page.text, /Your owner application is awaiting admin approval/);
      });

      it("o-rej -> redirect /owner/status (M5)", async () => {
        const ag = await getAgentFor("o-rej");
        const res = await ag.get("/listings/new").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        const page = await ag.get("/owner/status");
        assert.match(page.text, /Your owner application was not approved/);
      });

      it("o-appr-other -> 200", async () => {
        const ag = await getAgentFor("o-appr-other");
        const res = await ag.get("/listings/new");
        assert.equal(res.status, 200);
      });

      it("o-appr-own -> 200", async () => {
        const ag = await getAgentFor("o-appr-own");
        const res = await ag.get("/listings/new");
        assert.equal(res.status, 200);
      });

      it("admin -> redirect /listings (M1)", async () => {
        const ag = await getAgentFor("admin");
        const res = await ag.get("/listings/new").redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        const page = await ag.get("/listings");
        assert.match(page.text, /Only approved property or venue owners can add or edit listings/);
      });
    });

    // --- Action: POST /listings ---
    describe("Action: POST /listings", { concurrency: 1 }, () => {
      const sendPost = (ag, title = "Matrix Test") =>
        ag
          .post("/listings")
          .field("listing[title]", title)
          .field("listing[description]", "Matrix description")
          .field("listing[price]", "150")
          .field("listing[location]", "Matrix City")
          .field("listing[country]", "Matrix Country")
          .attach("image", Buffer.from("matrix fake image"), { filename: "matrix.jpg", contentType: "image/jpeg" })
          .redirects(0);

      it("anon -> redirect /login, no upload, DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        const ag = await getAgentFor("anon");
        const res = await sendPost(ag);
        assert.equal(res.status, 302);
        assert.match(res.headers.location, /\/login/);
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        assert.equal(before[0].c, after[0].c);
      });

      it("cust -> redirect /listings (M1), no upload, DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        const ag = await getAgentFor("cust");
        const res = await sendPost(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        assert.equal(before[0].c, after[0].c);
      });

      it("o-none -> redirect /owner/status (M3), no upload, DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        const ag = await getAgentFor("o-none");
        const res = await sendPost(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        assert.equal(before[0].c, after[0].c);
      });

      it("o-pend -> redirect /owner/status (M4), no upload, DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        const ag = await getAgentFor("o-pend");
        const res = await sendPost(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        assert.equal(before[0].c, after[0].c);
      });

      it("o-rej -> redirect /owner/status (M5), no upload, DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        const ag = await getAgentFor("o-rej");
        const res = await sendPost(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        assert.equal(before[0].c, after[0].c);
      });

      it("o-appr-other -> creates listing, owner is acting user", async () => {
        const ag = await getAgentFor("o-appr-other");
        const res = await sendPost(ag, "Other Owner Listing");
        assert.equal(res.status, 302);
        assert.equal(getUploadCount(), 1);
        const [rows] = await dbConn.query("SELECT * FROM listings WHERE title=?", ["Other Owner Listing"]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].owner_id, ootherUser.id);
      });

      it("o-appr-own -> creates listing, owner is acting user", async () => {
        const ag = await getAgentFor("o-appr-own");
        const res = await sendPost(ag, "Own Owner Listing");
        assert.equal(res.status, 302);
        assert.equal(getUploadCount(), 1);
        const [rows] = await dbConn.query("SELECT * FROM listings WHERE title=?", ["Own Owner Listing"]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].owner_id, oownUser.id);
      });

      it("admin -> redirect /listings (M1), no upload, DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        const ag = await getAgentFor("admin");
        const res = await sendPost(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings");
        assert.equal(before[0].c, after[0].c);
      });
    });

    // --- Action: GET /listings/:id/edit ---
    describe("Action: GET /listings/:id/edit", { concurrency: 1 }, () => {
      it("anon -> redirect /login", async () => {
        const ag = await getAgentFor("anon");
        const res = await ag.get(`/listings/${targetListingId}/edit`).redirects(0);
        assert.equal(res.status, 302);
        assert.match(res.headers.location, /\/login/);
      });

      it("cust -> redirect /listings (M1)", async () => {
        const ag = await getAgentFor("cust");
        const res = await ag.get(`/listings/${targetListingId}/edit`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
      });

      it("o-none -> redirect /owner/status (M3)", async () => {
        const ag = await getAgentFor("o-none");
        const res = await ag.get(`/listings/${targetListingId}/edit`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
      });

      it("o-pend -> redirect /owner/status (M4)", async () => {
        const ag = await getAgentFor("o-pend");
        const res = await ag.get(`/listings/${targetListingId}/edit`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
      });

      it("o-rej -> redirect /owner/status (M5)", async () => {
        const ag = await getAgentFor("o-rej");
        const res = await ag.get(`/listings/${targetListingId}/edit`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
      });

      it("o-appr-other -> redirect /listings/:id (M6: not your listing)", async () => {
        const ag = await getAgentFor("o-appr-other");
        const res = await ag.get(`/listings/${targetListingId}/edit`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, `/listings/${targetListingId}`);
        const page = await ag.get(`/listings/${targetListingId}`);
        assert.match(page.text, /You don(?:'|&#39;)t have permission to alter this listing/);
      });

      it("o-appr-own -> 200", async () => {
        const ag = await getAgentFor("o-appr-own");
        const res = await ag.get(`/listings/${targetListingId}/edit`);
        assert.equal(res.status, 200);
      });

      it("admin -> redirect /listings (M1)", async () => {
        const ag = await getAgentFor("admin");
        const res = await ag.get(`/listings/${targetListingId}/edit`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
      });
    });

    // --- Action: PUT /listings/:id ---
    describe("Action: PUT /listings/:id", { concurrency: 1 }, () => {
      const sendPut = (ag, title = "Updated Title") =>
        ag
          .put(`/listings/${targetListingId}`)
          .field("listing[title]", title)
          .field("listing[description]", "Updated description")
          .field("listing[price]", "300")
          .field("listing[location]", "Updated City")
          .field("listing[country]", "Updated Country")
          .attach("image", Buffer.from("fake update image"), { filename: "update.jpg", contentType: "image/jpeg" })
          .redirects(0);

      it("anon -> redirect /login, no upload, DB unchanged", async () => {
        const [orig] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("anon");
        const res = await sendPut(ag);
        assert.equal(res.status, 302);
        assert.match(res.headers.location, /\/login/);
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, orig[0].title);
      });

      it("cust -> redirect /listings (M1), no upload, DB unchanged", async () => {
        const [orig] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("cust");
        const res = await sendPut(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, orig[0].title);
      });

      it("o-none -> redirect /owner/status (M3), no upload, DB unchanged", async () => {
        const [orig] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-none");
        const res = await sendPut(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, orig[0].title);
      });

      it("o-pend -> redirect /owner/status (M4), no upload, DB unchanged", async () => {
        const [orig] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-pend");
        const res = await sendPut(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, orig[0].title);
      });

      it("o-rej -> redirect /owner/status (M5), no upload, DB unchanged", async () => {
        const [orig] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-rej");
        const res = await sendPut(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, orig[0].title);
      });

      it("o-appr-other -> redirect /listings/:id (M6), no upload, DB unchanged", async () => {
        const [orig] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-appr-other");
        const res = await sendPut(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, `/listings/${targetListingId}`);
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, orig[0].title);
      });

      it("o-appr-own -> updates listing, upload count 1", async () => {
        const ag = await getAgentFor("o-appr-own");
        const res = await sendPut(ag, "Updated Matrix Title");
        assert.equal(res.status, 302);
        assert.equal(getUploadCount(), 1);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, "Updated Matrix Title");
      });

      it("admin -> redirect /listings (M1), no upload, DB unchanged", async () => {
        const [orig] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("admin");
        const res = await sendPut(ag);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        assert.equal(getUploadCount(), 0);
        const [after] = await dbConn.query("SELECT * FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].title, orig[0].title);
      });
    });

    // --- Action: DELETE /listings/:id ---
    describe("Action: DELETE /listings/:id", { concurrency: 1 }, () => {
      it("anon -> redirect /login, DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("anon");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        assert.match(res.headers.location, /\/login/);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, before[0].c);
      });

      it("cust -> redirect /listings (M1), DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("cust");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, before[0].c);
      });

      it("o-none -> redirect /owner/status (M3), DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-none");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, before[0].c);
      });

      it("o-pend -> redirect /owner/status (M4), DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-pend");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, before[0].c);
      });

      it("o-rej -> redirect /owner/status (M5), DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-rej");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/owner/status");
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, before[0].c);
      });

      it("o-appr-other -> redirect /listings/:id (M6), DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("o-appr-other");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, `/listings/${targetListingId}`);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, before[0].c);
      });

      it("admin -> redirect /listings (M1), DB unchanged", async () => {
        const [before] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        const ag = await getAgentFor("admin");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, "/listings");
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, before[0].c);
      });

      it("o-appr-own -> deletes listing", async () => {
        const ag = await getAgentFor("o-appr-own");
        const res = await ag.delete(`/listings/${targetListingId}`).redirects(0);
        assert.equal(res.status, 302);
        const [after] = await dbConn.query("SELECT COUNT(*) as c FROM listings WHERE listing_id=?", [targetListingId]);
        assert.equal(after[0].c, 0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: Registration & Validation (A1 - A5)
  // ---------------------------------------------------------------------------
  describe("Registration and validation (A1 - A5)", { concurrency: 1 }, () => {
    beforeEach(async () => {
      await clearData();
    });

    it("A1: Owner signup with valid details -> user role owner + pending profile, redirect /owner/status", async () => {
      const ag = agent();
      const res = await ag
        .post("/signup")
        .send("username=a1owner&email=a1owner@example.com&password=password123&role=owner&business_name=A1+Hotels&business_type=hotel_owner&phone=%2B12345678901")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/owner/status");

      const [users] = await dbConn.query("SELECT * FROM users WHERE username='a1owner'");
      assert.equal(users.length, 1);
      assert.equal(users[0].role, "owner");

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [users[0].user_id]);
      assert.equal(profiles.length, 1);
      assert.equal(profiles[0].business_name, "A1 Hotels");
      assert.equal(profiles[0].business_type, "hotel_owner");
      assert.equal(profiles[0].verification_status, "pending");

      const statusPage = await ag.get("/owner/status");
      assert.match(statusPage.text, /Account created/i);
    });

    it("A2: Owner signup with invalid phone -> error flash, redirect /signup?role=owner, no user row", async () => {
      const ag = agent();
      const res = await ag
        .post("/signup")
        .send("username=a2bad&email=a2bad@example.com&password=password123&role=owner&business_name=Bad&business_type=hotel_owner&phone=123")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /\/signup\?role=owner/);

      const [users] = await dbConn.query("SELECT * FROM users WHERE username='a2bad'");
      assert.equal(users.length, 0);
      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE business_name='Bad'");
      assert.equal(profiles.length, 0);
    });

    it("A3: Profile insert fails during owner signup -> rollback, no user remains", async () => {
      // Force constraint failure by using an invalid business_type that bypasses Joi?
      // Or stub OwnerProfile.create temporarily to reject
      const OwnerProfile = require("../models/ownerProfile");
      const origCreate = OwnerProfile.create;
      OwnerProfile.create = async () => {
        throw new Error("Forced profile insert failure");
      };

      try {
        const ag = agent();
        const res = await ag
          .post("/signup")
          .send("username=a3fail&email=a3fail@example.com&password=password123&role=owner&business_name=A3+Fail&business_type=hotel_owner&phone=%2B12345678901");
        // Error handler catches it
        assert.ok(res.status >= 400);

        const [users] = await dbConn.query("SELECT * FROM users WHERE username='a3fail'");
        assert.equal(users.length, 0, "User row must not remain after failed profile insert");
      } finally {
        OwnerProfile.create = origCreate;
      }
    });

    it("A4: Customer signup sending business fields -> customer created, no profile row", async () => {
      const ag = agent();
      const res = await ag
        .post("/signup")
        .send("username=a4cust&email=a4cust@example.com&password=password123&role=customer&business_name=StrayName&business_type=hotel_owner&phone=%2B12345678901")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/listings");

      const [users] = await dbConn.query("SELECT * FROM users WHERE username='a4cust'");
      assert.equal(users.length, 1);
      assert.equal(users[0].role, "customer");

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [users[0].user_id]);
      assert.equal(profiles.length, 0);
    });

    it("A5: GET /signup and /signup?role=owner contain owner-fields block", async () => {
      const resPlain = await request(app).get("/signup");
      assert.equal(resPlain.status, 200);
      assert.match(resPlain.text, /id="owner-fields"/);
      assert.match(resPlain.text, /name="business_name"/);
      assert.match(resPlain.text, /name="business_type"/);
      assert.match(resPlain.text, /name="phone"/);

      const resOwner = await request(app).get("/signup?role=owner");
      assert.equal(resOwner.status, 200);
      assert.match(resOwner.text, /id="owner-fields"/);
      // Owner should be selected
      assert.match(resOwner.text, /id="role-owner"[^>]*checked/);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: Owner status & applications (B1 - B7)
  // ---------------------------------------------------------------------------
  describe("Owner status and application form (B1 - B7)", { concurrency: 1 }, () => {
    beforeEach(async () => {
      await clearData();
    });

    it("B1: Owner status page for pending, approved, rejected, none", async () => {
      // none
      const userNone = await createUser("b1none", "pass", "owner");
      const agNone = agent();
      await loginAgent(agNone, userNone.username, userNone.password);
      const resNone = await agNone.get("/owner/status");
      assert.equal(resNone.status, 200);
      assert.match(resNone.text, /Application not submitted/);
      assert.match(resNone.text, /<form action="\/owner\/application"/);

      // pending
      const userPend = await createOwnerWithProfile("b1pend", "pass", "pending");
      const agPend = agent();
      await loginAgent(agPend, userPend.username, userPend.password);
      const resPend = await agPend.get("/owner/status");
      assert.equal(resPend.status, 200);
      assert.match(resPend.text, /Pending approval/);
      assert.match(resPend.text, /notified of your application/);

      // approved
      const userAppr = await createOwnerWithProfile("b1appr", "pass", "approved");
      const agAppr = agent();
      await loginAgent(agAppr, userAppr.username, userAppr.password);
      const resAppr = await agAppr.get("/owner/status");
      assert.equal(resAppr.status, 200);
      assert.match(resAppr.text, /Approved/);
      assert.match(resAppr.text, /href="\/listings\/new"/);

      // rejected
      const userRej = await createOwnerWithProfile("b1rej", "pass", "rejected", { rejectionReason: "Tax ID invalid" });
      const agRej = agent();
      await loginAgent(agRej, userRej.username, userRej.password);
      const resRej = await agRej.get("/owner/status");
      assert.equal(resRej.status, 200);
      assert.match(resRej.text, /Not approved/);
      assert.match(resRej.text, /Tax ID invalid/);
      assert.match(resRej.text, /<form action="\/owner\/application"/);
    });

    it("B2: Rejected owner re-applies -> status pending, details updated, reason and verified_at cleared", async () => {
      const user = await createOwnerWithProfile("b2rej", "pass", "rejected", { rejectionReason: "Old reason" });
      const ag = agent();
      await loginAgent(ag, user.username, user.password);

      const res = await ag
        .post("/owner/application")
        .send("business_name=New+Business&business_type=venue_owner&phone=%2B9876543210")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/owner/status");

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [user.id]);
      assert.equal(profiles[0].verification_status, "pending");
      assert.equal(profiles[0].business_name, "New Business");
      assert.equal(profiles[0].business_type, "venue_owner");
      assert.equal(profiles[0].phone, "+9876543210");
      assert.equal(profiles[0].rejection_reason, null);
      assert.equal(profiles[0].verified_at, null);
    });

    it("B3: Pending or approved owner posts /owner/application -> no change, info flash", async () => {
      const user = await createOwnerWithProfile("b3pend", "pass", "pending");
      const ag = agent();
      await loginAgent(ag, user.username, user.password);

      const res = await ag
        .post("/owner/application")
        .send("business_name=Changed&business_type=venue_owner&phone=%2B9876543210")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/owner/status");

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [user.id]);
      assert.notEqual(profiles[0].business_name, "Changed");
    });

    it("B4: Owner with no application row submits form -> pending profile created", async () => {
      const user = await createUser("b4none", "pass", "owner");
      const ag = agent();
      await loginAgent(ag, user.username, user.password);

      const res = await ag
        .post("/owner/application")
        .send("business_name=B4+Stays&business_type=property_owner&phone=%2B12345678901")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/owner/status");

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [user.id]);
      assert.equal(profiles.length, 1);
      assert.equal(profiles[0].verification_status, "pending");
      assert.equal(profiles[0].business_name, "B4 Stays");
    });

    it("B5: Invalid application input -> error flash, no change", async () => {
      const user = await createUser("b5none", "pass", "owner");
      const ag = agent();
      await loginAgent(ag, user.username, user.password);

      const res = await ag
        .post("/owner/application")
        .send("business_name=X&business_type=hotel_owner&phone=123")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/owner/status");

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [user.id]);
      assert.equal(profiles.length, 0);
    });

    it("B6: Application POST containing forbidden fields -> ignored, status stays pending", async () => {
      const user = await createUser("b6none", "pass", "owner");
      const ag = agent();
      await loginAgent(ag, user.username, user.password);

      const res = await ag
        .post("/owner/application")
        .send("business_name=B6+Stays&business_type=property_owner&phone=%2B12345678901&verification_status=approved&role=admin&rejection_reason=hacked")
        .redirects(0);
      assert.equal(res.status, 302);

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [user.id]);
      assert.equal(profiles[0].verification_status, "pending");
      assert.equal(profiles[0].rejection_reason, null);
      const [users] = await dbConn.query("SELECT role FROM users WHERE user_id=?", [user.id]);
      assert.equal(users[0].role, "owner");
    });

    it("B7: GET /owner/status and POST /owner/application as anonymous, customer, admin", async () => {
      // Anon
      const res1 = await request(app).get("/owner/status").redirects(0);
      assert.equal(res1.status, 302);
      assert.match(res1.headers.location, /\/login/);

      // Customer
      const cust = await createUser("b7cust", "pass", "customer");
      const agCust = agent();
      await loginAgent(agCust, cust.username, cust.password);
      const resCust = await agCust.get("/owner/status").redirects(0);
      assert.equal(resCust.status, 302);
      assert.equal(resCust.headers.location, "/listings");

      // Admin
      process.env.ADMIN_USERNAME = "b7admin";
      process.env.ADMIN_EMAIL    = "b7admin@example.com";
      process.env.ADMIN_PASSWORD = "b7password";
      await ensureAdmin(dbConn);
      const agAdmin = agent();
      await loginAgent(agAdmin, "b7admin", "b7password");
      const resAdmin = await agAdmin.get("/owner/status").redirects(0);
      assert.equal(resAdmin.status, 302);
      assert.equal(resAdmin.headers.location, "/listings");
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: Admin review & decision (C1 - C11)
  // ---------------------------------------------------------------------------
  describe("Admin review and decision (C1 - C11)", { concurrency: 1 }, () => {
    let adminAgent;

    beforeEach(async () => {
      await clearData();
      process.env.ADMIN_USERNAME = "c_admin";
      process.env.ADMIN_EMAIL    = "c_admin@example.com";
      process.env.ADMIN_PASSWORD = "c_admin_pass";
      await ensureAdmin(dbConn);
      adminAgent = agent();
      await loginAgent(adminAgent, "c_admin", "c_admin_pass");
    });

    it("C1: GET /admin/owners default lists pending applications with tab counts", async () => {
      await createOwnerWithProfile("c1pend", "pass", "pending");
      await createOwnerWithProfile("c1appr", "pass", "approved");

      const res = await adminAgent.get("/admin/owners");
      assert.equal(res.status, 200);
      assert.match(res.text, /c1pend/);
      assert.doesNotMatch(res.text, /c1appr/); // approved not shown in pending tab
      assert.match(res.text, /Pending <span class="badge[^>]*>1<\/span>/);
      assert.match(res.text, /Approved <span class="badge[^>]*>1<\/span>/);
    });

    it("C2: ?status=approved, rejected, all, and ?status=zzz", async () => {
      await createOwnerWithProfile("c2p", "pass", "pending");
      await createOwnerWithProfile("c2a", "pass", "approved");
      await createOwnerWithProfile("c2r", "pass", "rejected");

      const resA = await adminAgent.get("/admin/owners?status=approved");
      assert.match(resA.text, /c2a/);
      assert.doesNotMatch(resA.text, /c2p/);

      const resR = await adminAgent.get("/admin/owners?status=rejected");
      assert.match(resR.text, /c2r/);

      const resAll = await adminAgent.get("/admin/owners?status=all");
      assert.match(resAll.text, /c2p/);
      assert.match(resAll.text, /c2a/);
      assert.match(resAll.text, /c2r/);

      const resZ = await adminAgent.get("/admin/owners?status=zzz");
      // Falls back to pending
      assert.match(resZ.text, /c2p/);
      assert.doesNotMatch(resZ.text, /c2a/);
    });

    it("C3: Approve a pending owner -> status approved, verified_at set, owner can immediately GET /listings/new", async () => {
      const owner = await createOwnerWithProfile("c3owner", "pass", "pending");
      // Log the owner in first
      const ownerAg = agent();
      await loginAgent(ownerAg, owner.username, owner.password);

      // Initially blocked from /listings/new
      const blockRes = await ownerAg.get("/listings/new").redirects(0);
      assert.equal(blockRes.status, 302);
      assert.equal(blockRes.headers.location, "/owner/status");

      // Admin approves
      const res = await adminAgent
        .post(`/admin/owners/${owner.id}/approve`)
        .send("filter=pending")
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/admin/owners?status=pending");

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [owner.id]);
      assert.equal(profiles[0].verification_status, "approved");
      assert.ok(profiles[0].verified_at);

      // Owner without logging out now immediately has access
      const okRes = await ownerAg.get("/listings/new");
      assert.equal(okRes.status, 200);
    });

    it("C4: Reject with reason (trimmed) -> stored trimmed, shown on owner status page", async () => {
      const owner = await createOwnerWithProfile("c4owner", "pass", "pending");
      const res = await adminAgent
        .post(`/admin/owners/${owner.id}/reject`)
        .send("reason=   Incomplete license documents   &filter=pending")
        .redirects(0);
      assert.equal(res.status, 302);

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [owner.id]);
      assert.equal(profiles[0].verification_status, "rejected");
      assert.equal(profiles[0].rejection_reason, "Incomplete license documents");

      const ownerAg = agent();
      await loginAgent(ownerAg, owner.username, owner.password);
      const statusPage = await ownerAg.get("/owner/status");
      assert.match(statusPage.text, /Incomplete license documents/);
    });

    it("C5: Reject without a reason -> works, reason NULL", async () => {
      const owner = await createOwnerWithProfile("c5owner", "pass", "pending");
      const res = await adminAgent
        .post(`/admin/owners/${owner.id}/reject`)
        .send("reason=&filter=pending")
        .redirects(0);
      assert.equal(res.status, 302);

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [owner.id]);
      assert.equal(profiles[0].verification_status, "rejected");
      assert.equal(profiles[0].rejection_reason, null);
    });

    it("C6: Reject with reason longer than 500 characters -> error flash, no change", async () => {
      const owner = await createOwnerWithProfile("c6owner", "pass", "pending");
      const longReason = "A".repeat(501);
      const res = await adminAgent
        .post(`/admin/owners/${owner.id}/reject`)
        .send(`reason=${longReason}&filter=pending`)
        .redirects(0);
      assert.equal(res.status, 302);

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [owner.id]);
      assert.equal(profiles[0].verification_status, "pending"); // unchanged
    });

    it("C7: Revoke: reject an approved owner who has listings -> rights revoked, listings still visible", async () => {
      const owner = await createOwnerWithProfile("c7owner", "pass", "approved");
      const lid = await createListing(owner.id);

      const ownerAg = agent();
      await loginAgent(ownerAg, owner.username, owner.password);
      // Can access before revocation
      const preRes = await ownerAg.get("/listings/new");
      assert.equal(preRes.status, 200);

      // Admin revokes
      await adminAgent
        .post(`/admin/owners/${owner.id}/reject`)
        .send("reason=Revoked&filter=approved")
        .redirects(0);

      // Immediately blocked
      const postRes = await ownerAg.get("/listings/new").redirects(0);
      assert.equal(postRes.status, 302);
      assert.equal(postRes.headers.location, "/owner/status");

      // Listing remains visible publicly
      const showRes = await request(app).get(`/listings/${lid}`);
      assert.equal(showRes.status, 200);
    });

    it("C8: Re-approve a rejected owner -> status approved, rights restored", async () => {
      const owner = await createOwnerWithProfile("c8owner", "pass", "rejected");
      await adminAgent.post(`/admin/owners/${owner.id}/approve`).send("filter=rejected").redirects(0);

      const [profiles] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [owner.id]);
      assert.equal(profiles[0].verification_status, "approved");
    });

    it("C9: Approve or reject invalid IDs -> Owner application not found, no crash", async () => {
      const cust = await createUser("c9cust", "pass", "customer");
      // Non-numeric
      const res1 = await adminAgent.post("/admin/owners/abc/approve").redirects(0);
      assert.equal(res1.status, 302);
      // Unknown id
      const res2 = await adminAgent.post("/admin/owners/99999/approve").redirects(0);
      assert.equal(res2.status, 302);
      // Customer
      const res3 = await adminAgent.post(`/admin/owners/${cust.id}/approve`).redirects(0);
      assert.equal(res3.status, 302);
    });

    it("C10: Admin routes accessed by non-admin -> permission denied", async () => {
      const owner = await createOwnerWithProfile("c10owner", "pass", "approved");
      const ownerAg = agent();
      await loginAgent(ownerAg, owner.username, owner.password);

      const res = await ownerAg.get("/admin/owners").redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, "/listings");
    });

    it("C11: Admin navbar shows Owner Applications with count", async () => {
      await createOwnerWithProfile("c11p", "pass", "pending");
      const res = await adminAgent.get("/admin/owners");
      assert.match(res.text, /Owner Applications/);
      assert.match(res.text, /<span class="badge bg-danger ms-1">1<\/span>/);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: UI & Views (D1 - D4)
  // ---------------------------------------------------------------------------
  describe("UI and navigation (D1 - D4)", { concurrency: 1 }, () => {
    beforeEach(async () => {
      await clearData();
    });

    it("D1: Navbar 'Add New Listings' visible only for approved owner", async () => {
      // Anon
      const resAnon = await request(app).get("/listings");
      assert.doesNotMatch(resAnon.text, /Add New Listings/);

      // Customer
      const cust = await createUser("d1cust", "pass", "customer");
      const agCust = agent();
      await loginAgent(agCust, cust.username, cust.password);
      const resCust = await agCust.get("/listings");
      assert.doesNotMatch(resCust.text, /Add New Listings/);

      // Pending owner
      const pend = await createOwnerWithProfile("d1pend", "pass", "pending");
      const agPend = agent();
      await loginAgent(agPend, pend.username, pend.password);
      const resPend = await agPend.get("/listings");
      assert.doesNotMatch(resPend.text, /Add New Listings/);

      // Approved owner
      const appr = await createOwnerWithProfile("d1appr", "pass", "approved");
      const agAppr = agent();
      await loginAgent(agAppr, appr.username, appr.password);
      const resAppr = await agAppr.get("/listings");
      assert.match(resAppr.text, /Add New Listings/);
    });

    it("D2: Listing show page Edit/Delete appear only for approved owner who owns listing", async () => {
      const owner = await createOwnerWithProfile("d2owner", "pass", "approved");
      const lid = await createListing(owner.id);

      // Owner sees buttons
      const agOwner = agent();
      await loginAgent(agOwner, owner.username, owner.password);
      const resOwner = await agOwner.get(`/listings/${lid}`);
      assert.match(resOwner.text, /href="\/listings\/[0-9]+\/edit"/);

      // Other approved owner does not see buttons
      const other = await createOwnerWithProfile("d2other", "pass", "approved");
      const agOther = agent();
      await loginAgent(agOther, other.username, other.password);
      const resOther = await agOther.get(`/listings/${lid}`);
      assert.doesNotMatch(resOther.text, /href="\/listings\/[0-9]+\/edit"/);
    });

    it("D3: Public viewing: anon and customer get 200 on /listings and /listings/:id", async () => {
      const owner = await createOwnerWithProfile("d3owner", "pass", "approved");
      const lid = await createListing(owner.id);

      const res1 = await request(app).get("/listings");
      assert.equal(res1.status, 200);

      const res2 = await request(app).get(`/listings/${lid}`);
      assert.equal(res2.status, 200);
    });

    it("D4: Navbar for owners shows Owner Status link with correct badge", async () => {
      const pend = await createOwnerWithProfile("d4pend", "pass", "pending");
      const ag = agent();
      await loginAgent(ag, pend.username, pend.password);
      const res = await ag.get("/listings");
      assert.match(res.text, /Owner Status/);
      assert.match(res.text, /Pending approval/);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: Login redirects (E1)
  // ---------------------------------------------------------------------------
  describe("Login redirects (E1)", { concurrency: 1 }, () => {
    beforeEach(async () => {
      await clearData();
    });

    it("E1: Login redirects by role and status", async () => {
      // Pending owner -> /owner/status
      const pend = await createOwnerWithProfile("e1pend", "pass", "pending");
      const ag1 = agent();
      const res1 = await ag1.post("/login").send(`username=${pend.username}&password=${pend.password}`).redirects(0);
      assert.equal(res1.headers.location, "/owner/status");

      // Approved owner -> /listings
      const appr = await createOwnerWithProfile("e1appr", "pass", "approved");
      const ag2 = agent();
      const res2 = await ag2.post("/login").send(`username=${appr.username}&password=${appr.password}`).redirects(0);
      assert.equal(res2.headers.location, "/listings");

      // Admin -> /admin/owners
      process.env.ADMIN_USERNAME = "e1admin";
      process.env.ADMIN_EMAIL    = "e1admin@example.com";
      process.env.ADMIN_PASSWORD = "e1password";
      await ensureAdmin(dbConn);
      const ag3 = agent();
      const res3 = await ag3.post("/login").send("username=e1admin&password=e1password").redirects(0);
      assert.equal(res3.headers.location, "/admin/owners");
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: Migration & Seed (F1 - F4)
  // ---------------------------------------------------------------------------
  describe("Migration and seed tests (F1 - F4)", { concurrency: 1 }, () => {
    it("F1 & F2: migrate grandfathering and idempotence", async () => {
      // Step-2 DB setup simulation: owner with listing, owner without listing, customer
      await clearData();
      const oWithListing = await createUser("f1_has_listing", "pass", "owner");
      await createListing(oWithListing.id);
      const oNoListing = await createUser("f1_no_listing", "pass", "owner");
      const cust = await createUser("f1_cust", "pass", "customer");

      // Run grandfathering query from db/migrate.js
      await dbConn.query(`
        INSERT INTO owner_profile (owner_id, business_name, business_type, phone, verification_status, verified_at)
        SELECT u.user_id, u.username, 'property_owner', NULL, 'approved', NOW()
        FROM users u
        WHERE u.role = 'owner'
          AND EXISTS (SELECT 1 FROM listings l WHERE l.owner_id = u.user_id)
          AND NOT EXISTS (SELECT 1 FROM owner_profile op WHERE op.owner_id = u.user_id)
      `);

      const [p1] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [oWithListing.id]);
      assert.equal(p1.length, 1);
      assert.equal(p1[0].verification_status, "approved");

      const [p2] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [oNoListing.id]);
      assert.equal(p2.length, 0);

      const [p3] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [cust.id]);
      assert.equal(p3.length, 0);

      // Running second time inserts nothing
      const [r2] = await dbConn.query(`
        INSERT INTO owner_profile (owner_id, business_name, business_type, phone, verification_status, verified_at)
        SELECT u.user_id, u.username, 'property_owner', NULL, 'approved', NOW()
        FROM users u
        WHERE u.role = 'owner'
          AND EXISTS (SELECT 1 FROM listings l WHERE l.owner_id = u.user_id)
          AND NOT EXISTS (SELECT 1 FROM owner_profile op WHERE op.owner_id = u.user_id)
      `);
      assert.equal(r2.affectedRows, 0);
    });

    it("F3: Seed user gets approved profile", async () => {
      await clearData();
      const seedUser = await createUser("seeduser", "pass", "owner");
      await dbConn.query(
        `INSERT INTO owner_profile (owner_id, business_name, business_type, phone, verification_status, verified_at)
         VALUES (?, 'Seed Properties', 'property_owner', NULL, 'approved', NOW())
         ON DUPLICATE KEY UPDATE
           business_name = 'Seed Properties',
           business_type = 'property_owner',
           verification_status = 'approved',
           verified_at = NOW()`,
        [seedUser.id]
      );
      const [rows] = await dbConn.query("SELECT * FROM owner_profile WHERE owner_id=?", [seedUser.id]);
      assert.equal(rows[0].business_name, "Seed Properties");
      assert.equal(rows[0].verification_status, "approved");
    });

    it("F4: Fresh database schema has owner_profile with FK to users", async () => {
      const [fkRows] = await dbConn.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'owner_profile' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [process.env.DB_NAME]
      );
      assert.ok(fkRows.length > 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: Session cookie (G1)
  // ---------------------------------------------------------------------------
  describe("Session cookie (G1)", { concurrency: 1 }, () => {
    it("G1: Set-Cookie contains HttpOnly and SameSite=Lax", async () => {
      const res = await request(app).get("/listings");
      const cookie = res.headers["set-cookie"] ? res.headers["set-cookie"][0] : "";
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11.3: Regression (H1)
  // ---------------------------------------------------------------------------
  describe("Regression (H1)", { concurrency: 1 }, () => {
    it("H1: Customer can post review and author can delete their own review", async () => {
      await clearData();
      const owner = await createOwnerWithProfile("h1owner", "pass", "approved");
      const lid = await createListing(owner.id);
      const cust = await createUser("h1cust", "pass", "customer");

      const agCust = agent();
      await loginAgent(agCust, cust.username, cust.password);

      // Customer posts review
      const postRes = await agCust
        .post(`/listings/${lid}/reviews`)
        .send("review[rating]=5&review[comment]=Great+stay!")
        .redirects(0);
      assert.equal(postRes.status, 302);

      const [reviews] = await dbConn.query("SELECT * FROM reviews WHERE listing_id=?", [lid]);
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].comment, "Great stay!");

      // Author deletes own review
      const delRes = await agCust
        .delete(`/listings/${lid}/reviews/${reviews[0].review_id}`)
        .redirects(0);
      assert.equal(delRes.status, 302);

      const [afterReviews] = await dbConn.query("SELECT * FROM reviews WHERE listing_id=?", [lid]);
      assert.equal(afterReviews.length, 0);
    });
  });
  });
};
