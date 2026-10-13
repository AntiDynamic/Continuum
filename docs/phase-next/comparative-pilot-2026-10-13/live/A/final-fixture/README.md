# Warehouse reservations

Node 24 service, no installation required. Run `node --test tests/public.test.mjs`.
The API facade historically returns promises; its receipt has exactly reservationId,
totalCents and feeCents. Inventory belongs to tenants. The reservation schema must
support durable receipts and reversible deployment without losing existing stock.
