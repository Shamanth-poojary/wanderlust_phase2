const Listing = require("../models/listing");
const ExpressError = require("../utils/ExpressError");
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");
const mapToken = process.env.MAP_TOKEN;
const geocodingClient = mbxGeocoding({ accessToken: mapToken });

// =======================
// INDEX
// =======================
module.exports.index = async (req, res) => {
  const alllistings = await Listing.findAll();
  res.render("listings/index.ejs", { alllistings });
};

// =======================
// NEW FORM
// =======================
module.exports.newform = (req, res) => {
  res.render("listings/new.ejs");
};

// =======================
// SHOW
// =======================
module.exports.showListing = async (req, res) => {
  const { id } = req.params;

  const listing = await Listing.findByIdWithDetails(id);

  if (!listing) {
    req.flash("error", "Listing not found");
    return res.redirect("/listings");
  }

  res.render("listings/show.ejs", { listing });
};

// =======================
// CREATE (F4, F8)
// =======================
module.exports.postListing = async (req, res) => {
  // multer safety check
  if (!req.file) {
    req.flash("error", "Image upload failed!");
    return res.redirect("/listings/new");
  }

  // F8: Guard against no geocoder match
  let response;
  try {
    response = await geocodingClient
      .forwardGeocode({ query: req.body.listing.location, limit: 1 })
      .send();
  } catch (err) {
    req.flash("error", "Could not find that location. Please enter a valid location.");
    return res.redirect("/listings/new");
  }

  const features = response.body.features;
  if (!features || features.length === 0) {
    req.flash("error", "Could not find that location. Please enter a valid location.");
    return res.redirect("/listings/new");
  }

  const [longitude, latitude] = features[0].geometry.coordinates;
  const { title, description, price, location, country } = req.body.listing;

  const newId = await Listing.create({
    ownerId: req.user.id,
    title,
    description,
    price,
    location,
    country,
    imageUrl: req.file.path,
    imageFilename: req.file.filename,
    latitude,
    longitude,
  });

  req.flash("success", "Successfully created a new listing!");
  res.redirect("/listings");
};

// =======================
// EDIT FORM
// =======================
module.exports.editListing = async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id);

  if (!listing) {
    req.flash("error", "Listing not found");
    return res.redirect("/listings");
  }

  res.render("listings/edit.ejs", { listing });
};

// =======================
// UPDATE (F1, F8)
// =======================
module.exports.updateListing = async (req, res) => {
  const { id } = req.params;

  // Fetch current listing to compare location (F8)
  const existing = await Listing.findById(id);
  if (!existing) {
    req.flash("error", "Listing not found");
    return res.redirect("/listings");
  }

  // F1: Only whitelisted fields from body
  const { title, description, price, location, country } = req.body.listing;

  let latitude = existing.geometry ? existing.geometry.coordinates[1] : null;
  let longitude = existing.geometry ? existing.geometry.coordinates[0] : null;

  // F8: Re-geocode only when location changed
  if (location !== existing.location) {
    try {
      const response = await geocodingClient
        .forwardGeocode({ query: location, limit: 1 })
        .send();
      const features = response.body.features;
      if (!features || features.length === 0) {
        req.flash("error", "Could not find that location. Please enter a valid location.");
        return res.redirect(`/listings/${id}/edit`);
      }
      [longitude, latitude] = features[0].geometry.coordinates;
    } catch (err) {
      req.flash("error", "Could not find that location. Please enter a valid location.");
      return res.redirect(`/listings/${id}/edit`);
    }
  }

  const updateData = { title, description, price, location, country, latitude, longitude };

  // If user uploaded a new image
  if (req.file) {
    updateData.imageUrl = req.file.path;
    updateData.imageFilename = req.file.filename;
  }

  await Listing.update(id, updateData);

  req.flash("success", "Listing edited successfully!");
  res.redirect(`/listings/${id}`);
};

// =======================
// DELETE
// =======================
module.exports.deleteListing = async (req, res) => {
  const { id } = req.params;

  await Listing.remove(id);

  req.flash("success", "Successfully deleted a listing!");
  res.redirect("/listings");
};

