// Load real env so tests talk to the dev Postgres.
import "dotenv/config";

// Stub env so importing web-push at module-load time does not crash tests
// when VAPID has been overwritten by a stale .env or is missing.
process.env.VAPID_SUBJECT ??= "mailto:test@example.com";
process.env.VAPID_PUBLIC_KEY ??= "test-public-key";
process.env.VAPID_PRIVATE_KEY ??= "test-private-key";
