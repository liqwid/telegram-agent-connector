import { HTTPStatus } from "./httpStatus";

/**
 * Throw from inside a request handler to short-circuit with a specific status
 * and message. `callRequestHandler` converts it into an HTTP response instead
 * of letting it bubble to the Express error middleware.
 */
export class RequestError extends Error {
  public httpStatus: HTTPStatus;

  constructor(httpStatus: HTTPStatus, message: string) {
    super(message);
    this.name = "RequestError";
    this.httpStatus = httpStatus;
  }
}
