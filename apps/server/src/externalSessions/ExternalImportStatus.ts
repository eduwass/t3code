/**
 * ExternalImportStatus - in-memory registry of external-session imports that
 * are currently hydrating in the background.
 *
 * The resume route redirects to a thread immediately and forks the (slow)
 * hydration as a daemon. While that runs, the thread is marked here so the web
 * client can show an "Importing…" affordance instead of treating the partially
 * built thread as final state.
 *
 * @module ExternalImportStatus
 */
import { type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class ExternalImportStatus extends Context.Service<
  ExternalImportStatus,
  {
    /** Mark a thread as importing (hydration started). */
    readonly begin: (threadId: ThreadId) => Effect.Effect<void>;
    /** Clear a thread's importing flag (hydration finished or failed). */
    readonly end: (threadId: ThreadId) => Effect.Effect<void>;
    /** Thread ids currently importing. */
    readonly current: Effect.Effect<ReadonlyArray<string>>;
  }
>()("t3/externalSessions/ExternalImportStatus") {}

const make = Effect.gen(function* () {
  const importing = yield* Ref.make<ReadonlySet<string>>(new Set());
  return {
    begin: (threadId: ThreadId) =>
      Ref.update(importing, (set) => {
        const next = new Set(set);
        next.add(threadId);
        return next;
      }),
    end: (threadId: ThreadId) =>
      Ref.update(importing, (set) => {
        if (!set.has(threadId)) return set;
        const next = new Set(set);
        next.delete(threadId);
        return next;
      }),
    current: Ref.get(importing).pipe(Effect.map((set) => Array.from(set))),
  };
});

export const layer = Layer.effect(ExternalImportStatus, make);
