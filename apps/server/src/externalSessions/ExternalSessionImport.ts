/**
 * ExternalSessionImport - Import a coding-agent session that was started
 * outside T3 (e.g. a raw `claude` / `codex` / `opencode` CLI run) and bind it
 * to a resumable T3 thread.
 *
 * Discovery/parsing is delegated to the locally-running `agentsview` daemon,
 * which already indexes every supported CLI's on-disk session history and
 * exposes each session's native id, cwd and machine. We map that to T3's
 * existing provider resume machinery: create an orchestration thread for the
 * session's cwd, then pre-seed a `provider_session_runtime` binding whose
 * `resumeCursor` points at the provider-native session id. When the user
 * sends their first turn, `ProviderService.startSession` picks up that cursor
 * and resumes the original conversation — no new resume logic required.
 *
 * The T3 `threadId` is derived deterministically from (driver, nativeId) so
 * importing the same session twice reuses the same thread. The whole import is
 * a self-repairing idempotent saga: each step (project, thread, binding) is
 * checked against current state before it runs and re-checked on dispatch
 * conflict, so a partial failure can always be retried to completion.
 *
 * @module ExternalSessionImport
 */
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  defaultInstanceIdForDriver,
  DEFAULT_MODEL,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  ProjectId,
  ProviderDriverKind,
  type ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import { WorkspacePaths } from "../workspace/WorkspacePaths.ts";

/**
 * Per-provider mapping from the URL `provider` token to:
 *  - the T3 provider driver kind,
 *  - the agentsview session id (how the daemon namespaces this agent's ids),
 *  - the provider-native resume cursor shape consumed by the adapter.
 *
 * The URL always carries the bare native id (no agentsview prefix). The URL
 * `provider` token also equals the agentsview `agent` field, which we verify.
 */
export const PROVIDER_MAP: Record<
  string,
  {
    readonly driver: string;
    readonly agentsviewId: (nativeId: string) => string;
    readonly resumeCursor: (nativeId: string) => Record<string, string | boolean>;
  }
> = {
  claude: {
    driver: "claudeAgent",
    agentsviewId: (id) => id,
    resumeCursor: (id) => ({ resume: id }),
  },
  codex: {
    driver: "codex",
    agentsviewId: (id) => `codex:${id}`,
    // strictResume: an imported "resume session X" link must fail rather than
    // silently start a fresh empty Codex thread if the native thread is gone.
    resumeCursor: (id) => ({ threadId: id, strictResume: true }),
  },
  opencode: {
    driver: "opencode",
    agentsviewId: (id) => `opencode:${id}`,
    resumeCursor: (id) => ({ sessionId: id }),
  },
};

export const SUPPORTED_EXTERNAL_PROVIDERS = Object.keys(PROVIDER_MAP);

/** Native ids we accept: uuids and `ses_…`-style ids. No slashes/controls. */
const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

const AGENTSVIEW_BASE_URL = process.env.AGENTSVIEW_URL ?? "http://127.0.0.1:18080";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const AGENTSVIEW_TIMEOUT = "5 seconds";

export class ExternalSessionImportError extends Data.TaggedError("ExternalSessionImportError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export interface ExternalSessionImportResult {
  readonly threadId: ThreadId;
  readonly alreadyImported: boolean;
}

const AgentsviewSessionSchema = Schema.Struct({
  agent: Schema.String,
  cwd: Schema.String,
  machine: Schema.String,
  first_message: Schema.optional(Schema.String),
});
const decodeAgentsviewSession = Schema.decodeUnknownEffect(AgentsviewSessionSchema);

/** Build the agentsview request URL, enforcing a loopback-only daemon. */
function agentsviewSessionUrl(agentsviewId: string): string | undefined {
  let base: URL;
  try {
    base = new URL(AGENTSVIEW_BASE_URL);
  } catch {
    return undefined;
  }
  if (!LOOPBACK_HOSTNAMES.has(base.hostname)) {
    return undefined;
  }
  base.pathname = `/api/v1/sessions/${encodeURIComponent(agentsviewId)}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

/** UUIDv5-shaped id derived from a namespace key, for stable derived ids. */
function deterministicUuid(key: string): string {
  const bytes = NodeCrypto.createHash("sha1").update(key).digest().subarray(0, 16);
  // Force version 5 and RFC 4122 variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Stable thread id for an external session. Same (driver, nativeId) → same
 * thread, so repeated imports converge instead of duplicating.
 */
export function deterministicThreadId(driver: string, nativeId: string): string {
  return deterministicUuid(`t3-resume:${driver}:${nativeId}`);
}

/** Stable project id for a workspace root, so concurrent imports converge. */
function deterministicProjectId(workspaceRoot: string): string {
  return deterministicUuid(`t3-resume-project:${workspaceRoot}`);
}

interface AgentsviewSession {
  readonly cwd: string;
  readonly firstMessage?: string;
}

/** Last path segment of an absolute cwd, without pulling in node:path. */
function baseName(cwd: string): string {
  const segments = cwd.split(/[/\\]+/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "project";
}

const fetchAgentsviewSession = (agentsviewId: string, expectedAgent: string) =>
  Effect.gen(function* () {
    const url = agentsviewSessionUrl(agentsviewId);
    if (url === undefined) {
      return yield* new ExternalSessionImportError({
        reason: `agentsview URL must point at a loopback host (got ${AGENTSVIEW_BASE_URL}).`,
      });
    }
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient.get(url).pipe(
      Effect.timeout(AGENTSVIEW_TIMEOUT),
      Effect.mapError(
        (cause) =>
          new ExternalSessionImportError({
            reason: `Failed to reach agentsview at ${AGENTSVIEW_BASE_URL} (is the daemon running?).`,
            cause,
          }),
      ),
    );
    if (response.status !== 200) {
      return yield* new ExternalSessionImportError({
        reason: `agentsview returned ${response.status} for session '${agentsviewId}'.`,
      });
    }
    const raw = yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ExternalSessionImportError({
            reason: `Could not read agentsview response for '${agentsviewId}'.`,
            cause,
          }),
      ),
    );
    const decoded = yield* decodeAgentsviewSession(raw).pipe(
      Effect.mapError(
        (cause) =>
          new ExternalSessionImportError({
            reason: `Unexpected agentsview response shape for '${agentsviewId}'.`,
            cause,
          }),
      ),
    );
    if (decoded.agent !== expectedAgent) {
      return yield* new ExternalSessionImportError({
        reason: `Session '${agentsviewId}' is a '${decoded.agent}' session, not '${expectedAgent}'.`,
      });
    }
    if (decoded.machine !== "local") {
      return yield* new ExternalSessionImportError({
        reason: `Session lives on machine '${decoded.machine}', not this one. Resume only works where the CLI history is stored.`,
      });
    }
    const cwd = decoded.cwd.trim();
    if (cwd.length === 0) {
      return yield* new ExternalSessionImportError({
        reason: `Session '${agentsviewId}' has no recorded working directory; cannot resume.`,
      });
    }
    const session: AgentsviewSession = {
      cwd,
      ...(decoded.first_message !== undefined ? { firstMessage: decoded.first_message } : {}),
    };
    return session;
  });

const resolveModelSelection = (instanceId: ProviderInstanceId) =>
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;
    const instance = yield* registry.getInstance(instanceId);
    if (!instance) {
      return yield* new ExternalSessionImportError({
        reason: `Provider instance '${instanceId}' is not configured in T3 Code; cannot resume this session.`,
      });
    }
    const snapshot = yield* instance.snapshot.getSnapshot;
    // ponytail: first listed model is a reasonable default; resume continues
    // with the native session's own model regardless. Upgrade: use the
    // instance's configured default model selection when one is exposed.
    const model = snapshot.models[0]?.slug ?? DEFAULT_MODEL;
    const selection: ModelSelection = { instanceId, model };
    return selection;
  });

/** Resolve (find or deterministically create) the project owning `cwd`. */
const resolveProjectId = (workspaceRoot: string, modelSelection: ModelSelection) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const crypto = yield* Crypto.Crypto;

    const lookup = () =>
      projection
        .getActiveProjectByWorkspaceRoot(workspaceRoot)
        .pipe(
          Effect.mapError(
            (cause) =>
              new ExternalSessionImportError({ reason: "Failed to look up project.", cause }),
          ),
        );

    const existing = yield* lookup();
    if (Option.isSome(existing)) {
      return existing.value.id;
    }

    const projectId = ProjectId.make(deterministicProjectId(workspaceRoot));
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    // On success this is our deterministic id; on a concurrent-create conflict
    // we adopt whatever project now owns the workspace root (its id is what we
    // must return, not necessarily our deterministic one).
    return yield* engine
      .dispatch({
        type: "project.create",
        commandId: CommandId.make(yield* crypto.randomUUIDv4),
        projectId,
        title: baseName(workspaceRoot),
        workspaceRoot,
        defaultModelSelection: modelSelection,
        createdAt,
      })
      .pipe(
        Effect.as(projectId),
        Effect.catch((cause) =>
          lookup().pipe(
            Effect.flatMap((again) =>
              Option.isSome(again)
                ? Effect.succeed(again.value.id)
                : Effect.fail(
                    new ExternalSessionImportError({ reason: "Failed to create project.", cause }),
                  ),
            ),
          ),
        ),
      );
  });

export const importExternalSession = (input: {
  readonly provider: string;
  readonly sessionId: string;
}) =>
  Effect.gen(function* () {
    const mapping = PROVIDER_MAP[input.provider];
    if (!mapping) {
      return yield* new ExternalSessionImportError({
        reason: `Unsupported provider '${input.provider}'. Supported: ${SUPPORTED_EXTERNAL_PROVIDERS.join(", ")}.`,
      });
    }
    const nativeId = input.sessionId.trim();
    if (!isValidSessionId(nativeId)) {
      return yield* new ExternalSessionImportError({
        reason: "Invalid session id (expected up to 256 chars of [A-Za-z0-9._:-]).",
      });
    }

    const directory = yield* ProviderSessionDirectory;
    const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const workspacePaths = yield* WorkspacePaths;
    const crypto = yield* Crypto.Crypto;
    const threadId = ThreadId.make(deterministicThreadId(mapping.driver, nativeId));

    // Fully-imported short-circuit: resume is ready only when BOTH a binding
    // and an *active* thread exist. If the thread was archived/deleted, the
    // stale binding alone must not redirect into a dead thread — fall through
    // and re-create + re-bind. Read errors are failures, not "not imported".
    const existingBinding = yield* directory
      .getBinding(threadId)
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExternalSessionImportError({ reason: "Failed to read existing binding.", cause }),
        ),
      );
    const existingThread = yield* projection
      .getThreadShellById(threadId)
      .pipe(
        Effect.mapError(
          (cause) => new ExternalSessionImportError({ reason: "Failed to read thread.", cause }),
        ),
      );
    if (Option.isSome(existingBinding) && Option.isSome(existingThread)) {
      return { threadId, alreadyImported: true } satisfies ExternalSessionImportResult;
    }

    const meta = yield* fetchAgentsviewSession(mapping.agentsviewId(nativeId), input.provider);

    // Normalize through the same validation as ordinary project creation so a
    // stale/hostile agentsview cwd cannot create bogus project state.
    const cwd = yield* workspacePaths.normalizeWorkspaceRoot(meta.cwd).pipe(
      Effect.mapError(
        (cause) =>
          new ExternalSessionImportError({
            reason: `Session working directory is not a valid workspace: ${meta.cwd}`,
            cause,
          }),
      ),
    );

    const driver = ProviderDriverKind.make(mapping.driver);
    const instanceId = defaultInstanceIdForDriver(driver);
    const modelSelection = yield* resolveModelSelection(instanceId);

    // Create the thread only if it doesn't already exist (self-repair: a prior
    // run may have created the thread but failed before binding, or the thread
    // was archived/deleted while a stale binding lingered).
    if (Option.isNone(existingThread)) {
      const projectId = yield* resolveProjectId(cwd, modelSelection);
      const title = (meta.firstMessage ?? "").trim().slice(0, 80) || "Imported session";
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make(yield* crypto.randomUUIDv4),
          threadId,
          projectId,
          title,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        })
        .pipe(
          // A concurrent import may have created the thread first; tolerate it.
          Effect.catch((cause) =>
            projection.getThreadShellById(threadId).pipe(
              Effect.flatMap((again) =>
                Option.isSome(again)
                  ? Effect.void
                  : Effect.fail(
                      new ExternalSessionImportError({ reason: "Failed to create thread.", cause }),
                    ),
              ),
              Effect.catch(() =>
                Effect.fail(
                  new ExternalSessionImportError({ reason: "Failed to create thread.", cause }),
                ),
              ),
            ),
          ),
        );
    }

    // Pre-seed (or repair) the resume binding so the first turn resumes the
    // native session.
    yield* directory
      .upsert({
        threadId,
        provider: driver,
        providerInstanceId: instanceId,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        status: "stopped",
        resumeCursor: mapping.resumeCursor(nativeId),
        runtimePayload: { cwd, model: modelSelection.model, modelSelection },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExternalSessionImportError({ reason: "Failed to bind resume cursor.", cause }),
        ),
      );

    return { threadId, alreadyImported: false } satisfies ExternalSessionImportResult;
  });
