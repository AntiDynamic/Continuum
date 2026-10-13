import type {DatabaseSync} from 'node:sqlite';
import type {ReserveInput,Receipt} from './types.ts';
import {lookup,changeStock} from './catalog.ts';
import {computeTotal,computeFee} from './pricing.ts';
import {find,save,cancelStored} from './store.ts';
export function reserve(db:DatabaseSync,input:ReserveInput):Receipt {
 if (!Array.isArray(input.items) || input.items.length===0) throw new Error('EMPTY_ITEMS');
 const existing=find(db,input.tenantId,input.requestId);
 if(existing)return {reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents:existing.total_cents,feeCents:existing.fee_cents};
 db.exec('BEGIN IMMEDIATE');
 try {
  const again=find(db,input.tenantId,input.requestId);
  if (again) { db.exec('COMMIT'); return {reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents:again.total_cents,feeCents:again.fee_cents}; }
  const quantities=new Map<string,number>();
  for (const item of input.items) { if (!Number.isInteger(item.quantity)||item.quantity<=0) throw new Error('INVALID_QUANTITY'); quantities.set(item.sku,(quantities.get(item.sku)??0)+item.quantity); }
  const lines:Array<{quantity:number;unitPriceCents:number}>=[];
  for (const [sku,quantity] of quantities) { const row=lookup(db,input.tenantId,sku); if (!row) throw new Error('UNKNOWN_SKU'); if (row.stock<quantity) throw new Error('INSUFFICIENT_STOCK'); changeStock(db,input.tenantId,sku,-quantity); lines.push({quantity,unitPriceCents:row.unit_price_cents}); }
  const totalCents=computeTotal(lines),receipt={reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents,feeCents:computeFee(totalCents)}; save(db,input,receipt); db.exec('COMMIT'); return receipt;
 } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function cancel(db:DatabaseSync,tenantId:string,requestId:string):boolean { db.exec('BEGIN IMMEDIATE'); try { const result=cancelStored(db,tenantId,requestId); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
