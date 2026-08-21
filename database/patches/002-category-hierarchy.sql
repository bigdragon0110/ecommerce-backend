ALTER TABLE categories
  ADD COLUMN source_category_id INT NULL AFTER id,
  ADD UNIQUE KEY uq_categories_source_category_id (source_category_id);

CREATE TABLE IF NOT EXISTS product_categories (
  product_id BIGINT NOT NULL,
  category_id BIGINT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, category_id),
  KEY idx_product_categories_category (category_id, sort_order, product_id)
);

INSERT IGNORE INTO product_categories(product_id, category_id, is_primary, sort_order)
SELECT id, category_id, TRUE, 0 FROM products WHERE category_id IS NOT NULL;
