import type { Request, Response } from "express";
import type { ZodType } from "zod";

import { parseRequest } from "../parseModels";
import { callRequestHandler } from "./callRequestHandler";
import { HTTPStatus } from "./httpStatus";
import type { HandlerContext, HandlerFn, OutputType } from "./httpTypes";

/**
 * Extracts an auth payload from the request, or returns `null` if unauthorized.
 * May be async (e.g. a database-backed API-key lookup).
 */
export type AuthExtractor<Auth> = (
  req: Request,
) => Auth | null | Promise<Auth | null>;

type Params<
  BodyParser extends ZodType | undefined,
  QueryParser extends ZodType | undefined,
  PathParser extends ZodType | undefined,
> = {
  body: OutputType<BodyParser>;
  query: OutputType<QueryParser>;
  path: OutputType<PathParser>;
};

/**
 * Builds Express request handlers with typed, Zod-validated body/query/path and
 * a uniform `{ status, body }` return contract (see `httpTypes`). Immutable
 * builder: `.parse()` and `.withAuth()` return new, more-specifically-typed
 * handlers. Modelled on jupiter's `common/http` Handler, decoupled from any
 * specific auth provider.
 */
export class Handler<
  BodyParser extends ZodType | undefined = undefined,
  QueryParser extends ZodType | undefined = undefined,
  PathParser extends ZodType | undefined = undefined,
  Auth = undefined,
> {
  constructor(
    protected authExtractor: AuthExtractor<Auth> | undefined = undefined,
    protected bodyParser: BodyParser | undefined = undefined,
    protected queryParser: QueryParser | undefined = undefined,
    protected pathParser: PathParser | undefined = undefined,
  ) {}

  /** Attach an auth extractor, enabling `handleAuthorized`. */
  public withAuth = <NewAuth>(authExtractor: AuthExtractor<NewAuth>) =>
    new Handler<BodyParser, QueryParser, PathParser, NewAuth>(
      authExtractor,
      this.bodyParser,
      this.queryParser,
      this.pathParser,
    );

  /** Attach Zod parsers for the request body, query string and path params. */
  public parse = <
    NewBody extends ZodType | undefined = undefined,
    NewQuery extends ZodType | undefined = undefined,
    NewPath extends ZodType | undefined = undefined,
  >({
    body,
    query,
    path,
  }: {
    body?: NewBody;
    query?: NewQuery;
    path?: NewPath;
  }) =>
    new Handler<NewBody, NewQuery, NewPath, Auth>(
      this.authExtractor,
      body,
      query,
      path,
    );

  /** Public endpoint — no authorization required. */
  public handle =
    (
      requestHandler: HandlerFn<
        HandlerContext<Params<BodyParser, QueryParser, PathParser>>
      >,
    ) =>
    async (req: Request, res: Response) => {
      const params = this.parseParams(req);
      await callRequestHandler(
        requestHandler,
        { ...params, request: req },
        res,
      );
    };

  /** Authorized endpoint — runs the auth extractor and 401s when it returns null. */
  public handleAuthorized =
    (
      requestHandler: HandlerFn<
        HandlerContext<
          Params<BodyParser, QueryParser, PathParser> & { auth: Auth }
        >
      >,
    ) =>
    async (req: Request, res: Response) => {
      const auth = (await this.authExtractor?.(req)) ?? null;

      if (auth === null) {
        res.status(HTTPStatus.UNAUTHORIZED).send({ error: "Unauthorized" });
        return;
      }

      const params = this.parseParams(req);
      await callRequestHandler(
        requestHandler,
        { ...params, auth, request: req },
        res,
      );
    };

  protected parseParams = (
    req: Request,
  ): Params<BodyParser, QueryParser, PathParser> => ({
    body: parseSection<BodyParser>(this.bodyParser, req.body),
    query: parseSection<QueryParser>(this.queryParser, req.query),
    path: parseSection<PathParser>(this.pathParser, req.params),
  });
}

/**
 * Parse a request section with its (optional) parser. This is the single place
 * the wrapper asserts: TypeScript cannot prove that a conditionally-parsed value
 * matches the conditional type `OutputType<P>`, even though it always does at
 * runtime (the parser's output, or `undefined` when no parser is set).
 */
function parseSection<P extends ZodType | undefined>(
  parser: P | undefined,
  value: Record<string, unknown>,
): OutputType<P> {
  const parsed = parser ? parseRequest(parser, value) : undefined;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- irreducible generic boundary; see above
  return parsed as OutputType<P>;
}
