import type { Response } from "express";

import { captureError } from "../captureError";
import type { HandlerContext, HandlerFn } from "./httpTypes";
import { RequestError } from "./requestError";

async function safeCallHandler<Context extends HandlerContext<unknown>>(
  handler: HandlerFn<Context>,
  context: Context,
) {
  try {
    return await handler(context);
  } catch (error) {
    if (error instanceof RequestError) {
      return error;
    }
    throw error;
  }
}

/**
 * Runs a handler function and writes its result to the Express response.
 * `RequestError`s thrown inside the handler become HTTP responses here; any
 * other error is re-thrown so the Express error middleware can map it.
 */
export async function callRequestHandler<
  Context extends HandlerContext<unknown>,
>(handler: HandlerFn<Context>, context: Context, res: Response) {
  const output = await safeCallHandler(handler, context);

  if (output instanceof RequestError) {
    captureError(output);
    res.status(output.httpStatus).send({ error: output.message });
    return;
  }

  if (output.headers) {
    for (const [name, value] of Object.entries(output.headers)) {
      res.setHeader(name, value);
    }
  }

  res.status(output.status).send(output.body);
}
