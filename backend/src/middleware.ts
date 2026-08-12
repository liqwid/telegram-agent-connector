import { HTTPStatus, NotFoundError } from "common";
import { logger } from "common/logging";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import {
  AlreadyAuthorizedError,
  InvalidPasswordError,
  NoActiveLoginError,
  TelegramCredentialsError,
  TelegramLoginError,
} from "@/models/error";

/** Maps a domain error's `name` to the HTTP status it should produce. */
const errorStatusMap: Record<string, HTTPStatus> = {
  [NotFoundError.name]: HTTPStatus.NOT_FOUND,
  [AlreadyAuthorizedError.name]: HTTPStatus.CONFLICT,
  [NoActiveLoginError.name]: HTTPStatus.CONFLICT,
  // Operator misconfiguration (bad TELEGRAM_API_ID/TELEGRAM_API_HASH), not a
  // caller mistake.
  [TelegramCredentialsError.name]: HTTPStatus.INTERNAL_SERVER_ERROR,
  [InvalidPasswordError.name]: HTTPStatus.BAD_REQUEST,
  [TelegramLoginError.name]: HTTPStatus.BAD_GATEWAY,
};

export const loggingMiddleware: RequestHandler = (req, _res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(HTTPStatus.NOT_FOUND).json({ message: "Route not found" });
};

// Express 5 forwards rejected async handlers here automatically.
export const httpErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  _next,
) => {
  if (err instanceof ZodError) {
    res.status(HTTPStatus.BAD_REQUEST).json({
      message: "Validation failed",
      issues: err.issues,
    });
    return;
  }

  if (err instanceof Error) {
    const status = errorStatusMap[err.name];
    if (status) {
      res.status(status).json({ message: err.message });
      return;
    }
  }

  logger.error("Unhandled error", {}, err);
  res
    .status(HTTPStatus.INTERNAL_SERVER_ERROR)
    .json({ message: "Internal server error" });
};
