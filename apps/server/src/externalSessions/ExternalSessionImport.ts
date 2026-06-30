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
 * importing the same session twice reuses the same thread (idempotent) without
 * needing an extra schema column.
 *
 * @module ExternalSessionImport
 */
import { createHash } from "node:crypto";

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
import { HttpClient } from "effect/unstable/http";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";

/**
 * Per-provider mapping from the URL `provider` token to:
 *  - the T3 provider driver kind,
 *  - the agentsview session id (how the daemon namespaces this agent's ids),
 *  - the provider-native resume cursor shape consumed by the adapter.
 *
 * The URL always carries the bare native id (no agentsview prefix).
 */
export const PROVIDER_MAP: Record<
  string,
  {
    readonly driver: string;
    readonly agentsviewId: (nativeId: string) => string;
    readonly resumeCursor: (nativeId: string) => Record<string, string>;
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
    resumeCursor: (id) => ({ threadId: id }),
  },
  opencode: {
    driver: "opencode",
    agentsviewId: (id) => `opencode:${id}`,
    resumeCursor: (id) => ({ sessionId: id }),
  },
};

export const SUPPORTED_EXTERNAL_PROVIDERS = Object.keys(PROVIDER_MAP);

const AGENTSVIEW_BASE_URL = process.env.AGENTSVIEW_URL ?? "http://127.0.0.1:18080";

export class ExternalSessionImportError extends Data.TaggedError("ExternalSessionImportError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export interface ExternalSessionImportResult {
  readonly threadId: ThreadId;
  readonly alreadyImported: boolean;
}

interface AgentsviewSession {
  readonly agent: string;
  readonly cwd: string;
  readonly machine: string;
  readonly firstMessage?: string;
}

/** Last path segment of an absolute cwd, without pulling in node:path. */
function baseName(cwd: string): string {
  const segments = cwd.split(/[/\\]+/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "project";
}

/**
 * Deterministic UUIDv5-shaped id from (driver, nativeId) so repeated imports
 * of the same external session map to one stable T3 thread.
 */
export function deterministicThreadId(driver: string, nativeId: string): string {
  const bytes = createHash("sha1").update(`t3-resume:${driver}:${nativeId}`).digest().subarray(0, 16);
  // Force version 5 and RFC 4122 variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const fetchAgentsviewSession = (agentsviewId: string) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient
      .get(`${AGENTSVIEW_BASE_URL}/api/v1/sessions/${encodeURIComponent(agentsviewId)}`)
      .pipe(
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
    const raw = (yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ExternalSessionImportError({
            reason: `Could not parse agentsview response for '${agentsviewId}'.`,
            cause,
          }),
      ),
    )) as Record<string, unknown>;

    const cwd = typeof raw.cwd === "string" ? raw.cwd.trim() : "";
    if (cwd.length === 0) {
      return yield* new ExternalSessionImportError({
        reason: `Session '${agentsviewId}' has no recorded working directory; cannot resume.`,
      });
    }
    const session: AgentsviewSession = {
      agent: typeof raw.agent === "string" ? raw.agent : "",
      cwd,
      machine: typeof raw.machine === "string" ? raw.machine : "",
      ...(typeof raw.first_message === "string" ? { firstMessage: raw.first_message } : {}),
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
    const model = snapshot.models[0]?.slug ?? DEFAULT_MODEL;
    const selection: ModelSelection = { instanceId, model };
    return selection;
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
    if (nativeId.length === 0) {
      return yield* new ExternalSessionImportError({ reason: "Missing session id." });
    }

    const crypto = yield* Crypto.Crypto;
    const directory = yield* ProviderSessionDirectory;
    const threadId = ThreadId.make(deterministicThreadId(mapping.driver, nativeId));

    // Idempotency: if we already imported this session, just reuse the thread.
    const existingBinding = yield* directory
      .getBinding(threadId)
      .pipe(Effect.orElseSucceed(() => Option.none<unknown>()));
    if (Option.isSome(existingBinding)) {
      return { threadId, alreadyImported: true } satisfies ExternalSessionImportResult;
    }

    const meta = yield* fetchAgentsviewSession(mapping.agentsviewId(nativeId));
    if (meta.machine !== "local") {
      return yield* new ExternalSessionImportError({
        reason: `Session lives on machine '${meta.machine}', not this one. Resume only works where the CLI history is stored.`,
      });
    }

    const driver = ProviderDriverKind.make(mapping.driver);
    const instanceId = defaultInstanceIdForDriver(driver);
    const modelSelection = yield* resolveModelSelection(instanceId);

    const engine = yield* OrchestrationEngineService;
    const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;

    // Find-or-create the project that owns this cwd.
    const existingProject = yield* projection.getActiveProjectByWorkspaceRoot(meta.cwd);
    let projectId: ProjectId;
    if (Option.isSome(existingProject)) {
      projectId = existingProject.value.id;
    } else {
      projectId = ProjectId.make(yield* crypto.randomUUIDv4);
      const projectCreatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine
        .dispatch({
          type: "project.create",
          commandId: CommandId.make(yield* crypto.randomUUIDv4),
          projectId,
          title: baseName(meta.cwd),
          workspaceRoot: meta.cwd,
          defaultModelSelection: modelSelection,
          createdAt: projectCreatedAt,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ExternalSessionImportError({ reason: "Failed to create project.", cause }),
          ),
        );
    }

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
        Effect.mapError(
          (cause) => new ExternalSessionImportError({ reason: "Failed to create thread.", cause }),
        ),
      );

    // Pre-seed the resume binding so the first turn resumes the native session.
    yield* directory
      .upsert({
        threadId,
        provider: driver,
        providerInstanceId: instanceId,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        status: "stopped",
        resumeCursor: mapping.resumeCursor(nativeId),
        runtimePayload: { cwd: meta.cwd, model: modelSelection.model, modelSelection },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExternalSessionImportError({ reason: "Failed to bind resume cursor.", cause }),
        ),
      );

    return { threadId, alreadyImported: false } satisfies ExternalSessionImportResult;
  });
