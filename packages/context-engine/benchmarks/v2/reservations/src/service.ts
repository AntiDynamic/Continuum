import type {DatabaseSync} from 'node:sqlite';
import type {ReserveInput,Receipt} from './types.ts';
import {lookup,changeStock} from './catalog.ts';
import {computeTotal,computeFee} from './pricing.ts';
import {find,save} from './store.ts';
export function reserve(db:DatabaseSync,input:ReserveInput):Receipt {
 const existing=find(db,input.tenantId,input.requestId);
 if(existing)return {reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents:existing.total_cents,feeCents:existing.fee_cents};
 const lines=input.items.map(item=>{const row=lookup(db,input.tenantId,item.sku);if(!row)throw new Error('UNKNOWN_SKU');changeStock(db,input.tenantId,item.sku,-item.quantity);return {quantity:item.quantity,unitPriceCents:row.unit_price_cents};});
 const totalCents=computeTotal(lines),receipt={reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents,feeCents:computeFee(totalCents)};
 save(db,input,receipt);return receipt;
}
export function cancel(db:DatabaseSync,tenantId:string,requestId:string):boolean {return false;}
