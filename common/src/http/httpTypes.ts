import type { Request } from "express";
import type { z, ZodType } from "zod";

import type {
  HTTPErrorStatus,
  HTTPStatus,
  HTTPSuccessStatus,
} from "./httpStatus";

type ErrorResult = {
  status: HTTPErrorStatus;
  headers?: Record<string, string>;
  body?: { error: unknown };
};

type SuccessResult = {
  status: HTTPSuccessStatus;
  headers?: Record<string, string>;
  body?: unknown;
};

type NoContentResult = {
  status: HTTPStatus.NO_CONTENT;
  headers?: Record<string, string>;
  body?: undefined;
};

export type HandlerOutput = ErrorResult | SuccessResult | NoContentResult;

export type HandlerContext<Params> = Params & {
  request: Request;
};

export type HandlerFn<Context extends HandlerContext<unknown>> = (
  context: Context,
) => Promise<HandlerOutput>;

/** Resolves a Zod parser to its output type, or `undefined` when not provided. */
export type OutputType<Parser extends ZodType | undefined> =
  Parser extends ZodType ? z.output<Parser> : undefined;
