# Task Analysis

The deterministic analyzer normalizes the task and reports its class, classification reasons, mentioned paths/symbols/packages, keywords, likely languages, risk, risk reasons, complexity, and coverage policy.

Classes include documentation, local bugs, cross-file changes, test repair, configuration, dependency updates, database migrations, security-sensitive work, performance, refactors, new features, navigation, and unknown tasks. Migration/schema/rollback terms imply migration risk; authentication/token/secret/permission/trust terms imply critical security risk; refactor/move/rename terms imply cross-file risk.

These are explainable heuristics, not semantic understanding. An unknown classification is retained when no verified rule matches.
