# Approved smoke test: preflight blocked

No generation or compaction was launched. The user explicitly prohibited execution if telemetry could not be verified at preflight or strict safeguards could not be enforced.

Model metadata confirms that `gpt-5.6-luna` advertises low reasoning and the account is authenticated through ChatGPT. This does not prove effective inference settings or telemetry delivery.

See `report.json` for observed blockers and source hashes, `model-inspection.json` for the metadata-only result, and the copied protocol schemas for the installed host interface. No execution trace exists because execution did not begin.

Before using this approval, implement and verify an independent process watchdog, disable provider and stream retries, validate compaction resume settings, preserve complete failure and compaction traces, and establish a preflight telemetry check that does not itself invoke paid generation. If the host cannot provide that check, execution remains blocked under the current conditions. No token estimate should be represented as a billing cap.
