CREATE TABLE inventory(tenant_id TEXT NOT NULL,sku TEXT NOT NULL,stock INTEGER NOT NULL,unit_price_cents INTEGER NOT NULL,PRIMARY KEY(tenant_id,sku));
CREATE INDEX inventory_stock_idx ON inventory(tenant_id,sku,stock);
