export interface Item { sku: string; quantity: number }
export interface ReserveInput { tenantId: string; requestId: string; items: Item[] }
export interface Receipt { reservationId: string; totalCents: number; feeCents: number }
