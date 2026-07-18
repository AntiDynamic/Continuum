# Context Coverage

Coverage policies describe required and preferred categories for each task class. Local bugs require implementation and relevant tests. Database migrations additionally require schema and rollback evidence. Security-sensitive work requires implementation, tests, authoritative security constraints, and public contracts.

Coverage completion only adds keyword-related, category-verified candidates. It does not silently substitute unrelated tests. When required evidence is unavailable or cannot fit the budget, the packet is incomplete, names every missing category, and estimates additional required budget.
