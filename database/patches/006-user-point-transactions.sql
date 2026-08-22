-- Apply after 005-user-points-balance.sql.
-- Keeps an auditable history of every manual customer point adjustment.
CREATE TABLE IF NOT EXISTS user_point_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  admin_id BIGINT UNSIGNED NULL,
  amount BIGINT NOT NULL,
  balance_before BIGINT UNSIGNED NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_point_transactions_user_created (user_id, created_at),
  KEY idx_user_point_transactions_admin (admin_id),
  CONSTRAINT fk_user_point_transactions_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_point_transactions_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
