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

/** The account has no usable Telegram session — connect first (409). */
export class NotConnectedError extends CustomError {}

/** The referenced chat could not be resolved or accessed (404). */
export class ChatNotFoundError extends CustomError {}

/** Telegram rejected or failed an API request (502). */
export class TelegramRequestError extends CustomError {}

/** The request parameters make no sense together (400). */
export class InvalidRequestError extends CustomError {}
