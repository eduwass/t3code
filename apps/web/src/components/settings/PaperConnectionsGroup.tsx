// T3 Space fork: how this server reaches Paper. An ordered list of Paper Desktop
// and a Paper account; T3 tries the switched-on ones from the top.
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "@effect/atom-react";
import {
  paperConnectionOrder,
  type EnvironmentId,
  type PaperAccountResponse,
  type PaperConnectionKind,
  type PaperConnectionStatus,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { GripVerticalIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type Prompt = Extract<PaperAccountResponse, { readonly _tag: "signInStart" }>;
type SignIn =
  | { readonly status: "idle" }
  | { readonly status: "starting" }
  | { readonly status: "waiting"; readonly prompt: Prompt }
  | { readonly status: "failed"; readonly message: string };

const TITLES: Record<PaperConnectionKind, string> = {
  desktop: "Paper Desktop",
  account: "Paper account",
};

const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

const expiryTime = (expiresAt: number) =>
  new Date(expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function subtitle(status: PaperConnectionStatus | undefined, kind: PaperConnectionKind) {
  if (kind === "desktop") {
    return status?.label
      ? `${status.label} · fastest · needs the app open there`
      : "Not found. Install Paper Desktop on this machine, or set T3_PAPER_MCP_COMMAND.";
  }
  return status?.label
    ? `${status.label} · works with no Desktop open`
    : status?.state === "missing"
      ? "Sign in to use Paper without the Desktop app."
      : "Signed in · works with no Desktop open";
}

function StatusPill(props: { readonly status: PaperConnectionStatus | undefined }) {
  const status = props.status;
  if (status === undefined) return null;
  const latency = status.latencyMs === null ? "" : ` · ${(status.latencyMs / 1000).toFixed(1)}s`;
  const [text, tone] =
    status.state === "in-use"
      ? [`In use${latency}`, "success"]
      : status.state === "ready"
        ? ["Ready · backup", "success-hollow"]
        : status.state === "down"
          ? ["Not answering", "warning"]
          : status.state === "missing"
            ? [status.kind === "desktop" ? "Not found" : "Signed out", "muted"]
            : ["Off", "muted"];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "success" && "bg-success",
          tone === "success-hollow" && "border border-success",
          tone === "warning" && "bg-warning",
          tone === "muted" && "bg-muted-foreground/40",
        )}
      />
      {text}
    </span>
  );
}

function ConnectionRow(props: {
  readonly kind: PaperConnectionKind;
  readonly position: number;
  readonly enabled: boolean;
  readonly status: PaperConnectionStatus | undefined;
  readonly action: React.ReactNode;
  readonly onEnabledChange: (enabled: boolean) => void;
}) {
  const title = TITLES[props.kind];
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.kind });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5",
        isDragging && "relative z-10 rounded-md bg-background shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${title}, position ${props.position}`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <span className="w-3 shrink-0 text-xs text-muted-foreground tabular-nums">
        {props.position}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="truncate text-2xs text-muted-foreground">
          {subtitle(props.status, props.kind)}
        </p>
      </div>
      <StatusPill status={props.status} />
      {props.action}
      <Switch
        checked={props.enabled}
        onCheckedChange={(checked) => props.onEnabledChange(Boolean(checked))}
        aria-label={`Use ${title}`}
      />
    </li>
  );
}

export function PaperConnectionsGroup(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const saved = useScopedSettings((settings) => settings.paperConnections);
  const updateSettings = useUpdateScopedSettings();
  const order = paperConnectionOrder(saved);
  const statusQuery = useEnvironmentQuery(
    serverEnvironment.paper({ environmentId, input: { _tag: "connections" } }),
  );
  const statuses = statusQuery.data?._tag === "connections" ? statusQuery.data.connections : [];
  const statusOf = (kind: PaperConnectionKind) => statuses.find((entry) => entry.kind === kind);
  const { refresh } = statusQuery;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the server's live connection health each time the group opens
  useEffect(() => refresh(), [refresh]);

  const canSignIn = useAtomValue(serverEnvironment.paperAccount.permissionAtom(environmentId));
  const accountCommand = useAtomCommand(serverEnvironment.paperAccount, { reportFailure: false });
  const [signIn, setSignIn] = useState<SignIn>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500, target: "login link" });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = (next: ReadonlyArray<{ kind: PaperConnectionKind; enabled: boolean }>) => {
    updateSettings({ paperConnections: next });
    refresh();
  };

  const startSignIn = async () => {
    // Opened now, while the click still counts as the user's, then pointed at the login.
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    setSignIn({ status: "starting" });
    const started = await accountCommand({ environmentId, input: { _tag: "signInStart" } });
    if (started._tag !== "Success" || started.value._tag !== "signInStart") {
      tab?.close();
      setSignIn({
        status: "failed",
        message: started._tag === "Success" ? "Unexpected reply." : failureMessage(started.cause),
      });
      return;
    }
    const prompt = started.value;
    if (tab !== null) tab.location.href = prompt.verificationUriComplete ?? prompt.verificationUri;
    setSignIn({ status: "waiting", prompt });
    const finished = await accountCommand({ environmentId, input: { _tag: "signInWait" } });
    // A newer attempt or a cancel owns the state by now.
    setSignIn((current) => {
      if (current.status !== "waiting" || current.prompt !== prompt) return current;
      return finished._tag === "Success"
        ? { status: "idle" }
        : { status: "failed", message: failureMessage(finished.cause) };
    });
    refresh();
  };

  const signOut = async () => {
    setSignIn({ status: "idle" });
    await accountCommand({ environmentId, input: { _tag: "signOut" } });
    refresh();
  };

  const cancelSignIn = () => {
    setSignIn({ status: "idle" });
    void accountCommand({ environmentId, input: { _tag: "signInCancel" } });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null || event.active.id === event.over.id) return;
    const kinds = order.map((entry) => entry.kind);
    save(
      arrayMove(
        [...order],
        kinds.indexOf(event.active.id as PaperConnectionKind),
        kinds.indexOf(event.over.id as PaperConnectionKind),
      ),
    );
  };

  const desktop = statusOf("desktop");
  const account = statusOf("account");
  const accountSignedIn = account !== undefined && account.state !== "missing";
  const waiting = signIn.status === "waiting" ? signIn.prompt : null;
  const signInButton = (label: string) => (
    <Button
      size="xs"
      variant="outline"
      disabled={!canSignIn || signIn.status === "starting"}
      onClick={() => void startSignIn()}
    >
      {signIn.status === "starting" ? <Spinner className="size-3" /> : null}
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3 border-l border-border pl-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-foreground">Connect to Paper</p>
        <p className="text-2xs text-muted-foreground">
          T3 tries these from the top · drag to reorder
        </p>
      </div>

      {!accountSignedIn && waiting === null && !dismissed && statusQuery.data !== undefined ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <p className="text-muted-foreground">
            {desktop?.label
              ? `Paper Desktop on ${desktop.label} is set up. Add your Paper account as a backup, so Paper keeps working when that machine sleeps.`
              : "No Paper Desktop found for this machine. Sign in with your Paper account to use Paper without it."}
          </p>
          <div className="flex items-center gap-2">
            {signInButton(desktop?.label ? "Add Paper account" : "Sign in with Paper")}
            {desktop?.label ? (
              <Button size="xs" variant="ghost-muted" onClick={() => setDismissed(true)}>
                Not now
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {waiting !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-3" />
            Approve T3 Space in Paper's login. Check that it shows this code:
          </p>
          <p className="font-mono text-lg tracking-widest text-foreground">
            {waiting.userCode}
            <span className="ml-3 font-sans text-2xs tracking-normal text-muted-foreground">
              expires at {expiryTime(waiting.expiresAt)}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              render={
                <a
                  href={waiting.verificationUriComplete ?? waiting.verificationUri}
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
            >
              Open login again
            </Button>
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() =>
                copyToClipboard(waiting.verificationUriComplete ?? waiting.verificationUri)
              }
            >
              {isCopied ? "Copied" : "Copy link for another device"}
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={cancelSignIn}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {signIn.status === "failed" ? (
        <p className="text-2xs text-destructive-foreground">{signIn.message}</p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={order.map((entry) => entry.kind)}
          strategy={verticalListSortingStrategy}
        >
          <ol
            aria-label="Paper connections, tried first to last"
            className="divide-y divide-border rounded-lg border border-border"
          >
            {order.map((entry, index) => (
              <ConnectionRow
                key={entry.kind}
                kind={entry.kind}
                position={index + 1}
                enabled={entry.enabled}
                status={statusOf(entry.kind)}
                onEnabledChange={(enabled) =>
                  save(
                    order.map((item) => (item.kind === entry.kind ? { ...item, enabled } : item)),
                  )
                }
                action={
                  entry.kind === "account" ? (
                    accountSignedIn ? (
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        disabled={!canSignIn}
                        onClick={() => void signOut()}
                      >
                        Sign out
                      </Button>
                    ) : waiting === null ? (
                      signInButton("Sign in")
                    ) : null
                  ) : null
                }
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className="text-2xs text-muted-foreground">
        If one doesn't answer, T3 uses the next one. Turn one off and T3 never uses it.
      </p>
    </div>
  );
}
