CREATE DATABASE IF NOT EXISTS wanderlust
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wanderlust;

CREATE TABLE IF NOT EXISTS users (
  user_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)   NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          ENUM('customer','owner','admin') NOT NULL DEFAULT 'customer',
  admin_flag    TINYINT GENERATED ALWAYS AS (IF(role = 'admin', 1, NULL)) STORED,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_single_admin (admin_flag)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS owner_profile (
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
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;
