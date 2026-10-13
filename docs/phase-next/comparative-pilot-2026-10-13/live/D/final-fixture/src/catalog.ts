import type {DatabaseSync} from 'node:sqlite';
export function lookup(db:DatabaseSync, tenantId:string, sku:string) {
 return db.prepare('SELECT * FROM inventory WHERE tenant_id=? AND sku=?').get(tenantId,sku) as {stock:number;unit_price_cents:number}|undefined;
}
export function changeStock(db:DatabaseSync, tenantId:string, sku:string, delta:number) {
 db.prepare('UPDATE inventory SET stock=stock+? WHERE tenant_id=? AND sku=?').run(delta,tenantId,sku);
}
