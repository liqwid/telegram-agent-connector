// Vitest setup file: stubs the variables `@/env` requires, before any spec
// imports it.
process.env.NODE_ENV = "test";
process.env.ENCRYPTION_SECRET = "test-encryption-secret";
process.env.TELEGRAM_API_ID = "12345";
process.env.TELEGRAM_API_HASH = "0123456789abcdef0123456789abcdef";
