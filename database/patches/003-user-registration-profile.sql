-- Run once against the ecommerce database before enabling the expanded registration form.
ALTER TABLE users
  ADD COLUMN nickname VARCHAR(100) NULL AFTER last_name,
  ADD COLUMN marketing_consent BOOLEAN NOT NULL DEFAULT FALSE AFTER nickname,
  ADD COLUMN profile_public BOOLEAN NOT NULL DEFAULT FALSE AFTER marketing_consent,
  ADD COLUMN referral_code VARCHAR(100) NULL AFTER profile_public,
  ADD COLUMN terms_accepted_at DATETIME NULL AFTER referral_code,
  ADD COLUMN privacy_accepted_at DATETIME NULL AFTER terms_accepted_at,
  ADD UNIQUE KEY uq_users_nickname (nickname);
