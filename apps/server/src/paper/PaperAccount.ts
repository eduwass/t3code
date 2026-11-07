// T3 Space fork: signs this server in to a Paper account, for Paper's hosted MCP.
// The device-code token is for Paper's own app; one refresh with `resource` makes it
// one the MCP accepts. Refresh tokens rotate, so the newest session is always saved.
import { PaperSignInError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

export const PAPER_MCP_URL = "https://mcp.paper.design/";
const LOGIN = "https://login.paper.design/oauth2";
const RESOURCE = "https://mcp.paper.design";
const SCOPE = "openid email profile offline_access";
const SECRET = "paper-account";
const REQUEST_TIMEOUT = Duration.seconds(15);
// Refresh a little early so a token never lapses between the check and the call.
const REFRESH_MARGIN_MS = 30_000;

const Session = Schema.Struct({
  clientId: Schema.String,
  refreshToken: Schema.String,
  accessToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.Number,
  email: Schema.NullOr(Schema.String),
});
type Session = typeof Session.Type;
const SessionJson = Schema.fromJsonString(Session);
const decodeSession = Schema.decodeUnknownOption(SessionJson);
const encodeSession = Schema.encodeSync(SessionJson);

const TokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});
type TokenResponse = typeof TokenResponse.Type;

const DeviceResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
});

const Registration = Schema.Struct({ client_id: Schema.String });

/** The `email` claim of a JWT, read without verifying it; it only labels the account. */
export const emailFromJwt = (jwt: string | undefined): string | null => {
  const payload = jwt?.split(".")[1];
  if (payload === undefined) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && "email" in claims
      ? typeof claims.email === "string"
        ? claims.email
        : null
      : null;
  } catch {
    return null;
  }
};

const signInError = (reason: PaperSignInError["reason"], detail: string) =>
  new PaperSignInError({ reason, detail });

export interface PaperSignInPrompt {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string | null;
  readonly expiresAt: number;
}

interface Pending {
  readonly done: Deferred.Deferred<string | null, PaperSignInError>;
  readonly fiber: Fiber.Fiber<unknown>;
}

export const make = Effect.fn("PaperAccount.make")(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const http = yield* HttpClient.HttpClient;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const pending = yield* Ref.make<Pending | null>(null);

  const readSession = secrets.get(SECRET).pipe(
    Effect.map(Option.flatMap((bytes) => decodeSession(new TextDecoder().decode(bytes)))),
    Effect.orElseSucceed(() => Option.none<Session>()),
  );
  const writeSession = (session: Session) =>
    secrets.set(SECRET, new TextEncoder().encode(encodeSession(session)));

  const post = <S extends Schema.Top>(
    url: string,
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
  ) =>
    http.execute(request.pipe(HttpClientRequest.setHeaders({ accept: "application/json" }))).pipe(
      // Paper answers refused grants with 400 and an `error` body, which the schema still reads.
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError((cause) => signInError("failed", `Could not reach ${url}: ${String(cause)}`)),
    );
  const postForm = <S extends Schema.Top>(path: string, body: Record<string, string>, schema: S) =>
    post(
      `${LOGIN}${path}`,
      HttpClientRequest.post(`${LOGIN}${path}`).pipe(HttpClientRequest.bodyUrlParams(body)),
      schema,
    );

  /** Trades a refresh token for an MCP access token and the next refresh token. */
  const refreshWith = Effect.fn("PaperAccount.refreshWith")(function* (
    clientId: string,
    refreshToken: string,
    email: string | null,
  ) {
    const response = yield* postForm(
      "/token",
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        resource: RESOURCE,
      },
      TokenResponse,
    );
    if (response.access_token === undefined) {
      return yield* signInError(
        response.error === "invalid_grant" ? "expired" : "failed",
        response.error_description ?? response.error ?? "Paper did not refresh the sign-in.",
      );
    }
    const now = yield* Clock.currentTimeMillis;
    return {
      clientId,
      refreshToken: response.refresh_token ?? refreshToken,
      accessToken: response.access_token,
      accessTokenExpiresAt: now + (response.expires_in ?? 300) * 1000,
      email: emailFromJwt(response.id_token) ?? emailFromJwt(response.access_token) ?? email,
    } satisfies Session;
  });

  const poll = Effect.fn("PaperAccount.poll")(function* (
    clientId: string,
    deviceCode: string,
    expiresAt: number,
    initialInterval: number,
  ) {
    let interval = initialInterval;
    while (true) {
      yield* Effect.sleep(Duration.seconds(interval));
      if ((yield* Clock.currentTimeMillis) >= expiresAt) {
        return yield* signInError("expired", "The sign-in code expired. Start again.");
      }
      const answer: Option.Option<TokenResponse> = yield* postForm(
        "/token",
        {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientId,
          resource: RESOURCE,
        },
        TokenResponse,
      ).pipe(Effect.option);
      // A dropped poll is retried on the next tick; the code stays valid until it expires.
      if (Option.isNone(answer)) continue;
      const response = answer.value;
      if (response.refresh_token !== undefined) {
        const email = emailFromJwt(response.id_token) ?? emailFromJwt(response.access_token);
        const session = yield* refreshWith(clientId, response.refresh_token, email);
        yield* writeSession(session).pipe(
          Effect.mapError(() => signInError("failed", "The server could not save the sign-in.")),
        );
        return session.email;
      }
      switch (response.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval = response.interval ?? interval + 5;
          continue;
        case "expired_token":
          return yield* signInError("expired", "The sign-in code expired. Start again.");
        case "access_denied":
          return yield* signInError("denied", "The sign-in was declined in Paper.");
        default:
          return yield* signInError(
            "failed",
            response.error_description ??
              `Paper refused the sign-in (${response.error ?? "no token"}).`,
          );
      }
    }
  });

  const cancel = Effect.gen(function* () {
    const current = yield* Ref.getAndSet(pending, null);
    if (current === null) return;
    yield* Fiber.interrupt(current.fiber);
    yield* Deferred.fail(current.done, signInError("cancelled", "The sign-in was cancelled."));
  });

  const start = Effect.fn("PaperAccount.start")(function* () {
    yield* cancel;
    const registration = yield* post(
      `${LOGIN}/register`,
      HttpClientRequest.post(`${LOGIN}/register`).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          client_name: "T3 Space",
          grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
          token_endpoint_auth_method: "none",
          // Device-code clients never redirect, but registration asks for one.
          redirect_uris: ["http://127.0.0.1:1/callback"],
        }),
      ),
      Registration,
    );
    const device = yield* postForm(
      "/device_authorization",
      { client_id: registration.client_id, scope: SCOPE, resource: RESOURCE },
      DeviceResponse,
    );
    const expiresAt = (yield* Clock.currentTimeMillis) + device.expires_in * 1000;
    const done = yield* Deferred.make<string | null, PaperSignInError>();
    const fiber = yield* poll(
      registration.client_id,
      device.device_code,
      expiresAt,
      device.interval ?? 5,
    ).pipe(
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(done, exit)),
      Effect.ensuring(Ref.update(pending, (current) => (current?.done === done ? null : current))),
      Effect.forkIn(scope),
    );
    yield* Ref.set(pending, { done, fiber });
    return {
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      verificationUriComplete: device.verification_uri_complete ?? null,
      expiresAt,
    } satisfies PaperSignInPrompt;
  });

  const wait = Effect.gen(function* () {
    const current = yield* Ref.get(pending);
    if (current === null) return yield* signInError("not-started", "No Paper sign-in is running.");
    return yield* Deferred.await(current.done);
  });

  const signOut = Effect.gen(function* () {
    yield* cancel;
    yield* secrets.remove(SECRET).pipe(Effect.ignore);
  });

  /** A fresh MCP access token, refreshed when due; none when no account is signed in. */
  const token = lock.withPermits(1)(
    Effect.gen(function* () {
      const session = yield* readSession;
      if (Option.isNone(session)) return Option.none<string>();
      const now = yield* Clock.currentTimeMillis;
      const { accessToken, accessTokenExpiresAt } = session.value;
      if (accessToken !== null && now < accessTokenExpiresAt - REFRESH_MARGIN_MS) {
        return Option.some(accessToken);
      }
      const next = yield* refreshWith(
        session.value.clientId,
        session.value.refreshToken,
        session.value.email,
      ).pipe(
        Effect.tapError((error) =>
          // Paper retired the refresh token, so the account is signed out for good.
          error.reason === "expired" ? secrets.remove(SECRET).pipe(Effect.ignore) : Effect.void,
        ),
      );
      // Paper has already retired the old refresh token, so the new one must be kept.
      yield* writeSession(next).pipe(
        Effect.catch((cause) =>
          Effect.logError("Could not save the refreshed Paper sign-in.", { cause }),
        ),
      );
      return Option.some(next.accessToken);
    }),
  );

  /** Forces a refresh on the next `token`, after the MCP refused the current one. */
  const invalidate = lock.withPermits(1)(
    readSession.pipe(
      Effect.flatMap((session) =>
        Option.isNone(session)
          ? Effect.void
          : writeSession({ ...session.value, accessToken: null }).pipe(Effect.ignore),
      ),
    ),
  );

  const email = readSession.pipe(
    Effect.map((session) =>
      Option.isSome(session) ? Option.some(session.value.email) : Option.none(),
    ),
  );

  return { start, wait, cancel, signOut, token, invalidate, email };
});

export type PaperAccount = Effect.Success<ReturnType<typeof make>>;
