import type {DatabaseSync} from 'node:sqlite';
export function lookup(db:DatabaseSync, tenantId:string, sku:string) {
 return db.prepare('SELECT * FROM inventory WHERE sku=? LIMIT 1').get(sku) as {stock:number;unit_price_cents:number}|undefined;
}
export function changeStock(db:DatabaseSync, tenantId:string, sku:string, delta:number) {
 db.prepare('UPDATE inventory SET stock=stock+? WHERE sku=?').run(delta,sku);
}
