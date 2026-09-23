// Stub env so importing prisma client at module-load time does not crash tests.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.VAPID_SUBJECT ??= "mailto:test@example.com";
process.env.VAPID_PUBLIC_KEY ??= "test-public-key";
process.env.VAPID_PRIVATE_KEY ??= "test-private-key";
