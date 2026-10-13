-- up
CREATE TABLE reservations(tenant_id TEXT NOT NULL,request_id TEXT NOT NULL,items_json TEXT NOT NULL,total_cents INTEGER NOT NULL,fee_cents INTEGER NOT NULL,status TEXT NOT NULL,UNIQUE(tenant_id,request_id));
-- down
DROP TABLE reservations;
