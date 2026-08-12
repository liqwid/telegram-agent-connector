import { CustomError } from "common";

/**
 * Domain errors. Each subclass carries a stable `name` that `middleware.ts`
 * maps to an HTTP status. Messages are safe to surface to API callers.
 */

/** The account already holds a Telegram session (409). */
export class AlreadyAuthorizedError extends CustomError {}

/** No QR login is in flight for the requested operation (409). */
export class NoActiveLoginError extends CustomError {}

/** Telegram rejected the deployment's api_id/api_hash pair (500). */
export class TelegramCredentialsError extends CustomError {}

/** Telegram rejected the 2FA cloud password (400). */
export class InvalidPasswordError extends CustomError {}

/** The QR login flow failed on the Telegram side (502). */
export class TelegramLoginError extends CustomError {}
