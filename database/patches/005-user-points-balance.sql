-- Run once against the ecommerce database before enabling point payments.
ALTER TABLE users
  ADD COLUMN balance BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER status;
