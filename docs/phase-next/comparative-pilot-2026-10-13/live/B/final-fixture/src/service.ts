import type {DatabaseSync} from 'node:sqlite';
import type {ReserveInput,Receipt} from './types.ts';
import {lookup,changeStock} from './catalog.ts';
import {computeTotal,computeFee} from './pricing.ts';
import {find,save} from './store.ts';
export function reserve(db:DatabaseSync,input:ReserveInput):Receipt {
 if(!Array.isArray(input.items)||input.items.length===0)throw new Error('EMPTY_ITEMS');
 for(const item of input.items) if(!Number.isInteger(item.quantity)||item.quantity<=0)throw new Error('INVALID_QUANTITY');
 db.exec('BEGIN IMMEDIATE');
 try { const existing=find(db,input.tenantId,input.requestId); if(existing){db.exec('COMMIT');return {reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents:existing.total_cents,feeCents:existing.fee_cents};}
  const quantities=new Map<string,number>(); for(const item of input.items) quantities.set(item.sku,(quantities.get(item.sku)||0)+item.quantity);
  const lines=[]; for(const [sku,quantity] of quantities){const row=lookup(db,input.tenantId,sku);if(!row)throw new Error('UNKNOWN_SKU');if(row.stock<quantity)throw new Error('INSUFFICIENT_STOCK');lines.push({sku,quantity,unitPriceCents:row.unit_price_cents});}
  for(const line of lines) changeStock(db,input.tenantId,line.sku,-line.quantity);
  const totalCents=computeTotal(lines),receipt={reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents,feeCents:computeFee(totalCents)}; save(db,input,receipt);db.exec('COMMIT');return receipt;
 } catch(error){db.exec('ROLLBACK');throw error;}
}
export function cancel(db:DatabaseSync,tenantId:string,requestId:string):boolean { db.exec('BEGIN IMMEDIATE'); try {const row=find(db,tenantId,requestId);if(!row||row.status!=='active'){db.exec('COMMIT');return false;} for(const item of JSON.parse(row.items_json)) changeStock(db,tenantId,item.sku,item.quantity); db.prepare('UPDATE reservations SET status=? WHERE tenant_id=? AND request_id=? AND status=?').run('cancelled',tenantId,requestId,'active');db.exec('COMMIT');return true;} catch(error){db.exec('ROLLBACK');throw error;} }
