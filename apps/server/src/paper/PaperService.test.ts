import { describe, expect, it } from "vite-plus/test";

import { emailFromJwt } from "./PaperAccount.ts";
import { replyMessage } from "./PaperHostedConnection.ts";
import { attemptOrder, isDeletedFrame, sshHost } from "./PaperService.ts";

describe("attemptOrder", () => {
  it("keeps the saved order and moves a connection that just failed to the end", () => {
    const down = new Map([["desktop" as const, { downUntil: 2_000 }]]);
    expect(attemptOrder(["desktop", "account"], new Map(), 1_000)).toEqual(["desktop", "account"]);
    expect(attemptOrder(["desktop", "account"], down, 1_000)).toEqual(["account", "desktop"]);
    expect(attemptOrder(["desktop", "account"], down, 3_000)).toEqual(["desktop", "account"]);
  });
});

describe("sshHost", () => {
  it.each([
    [`ssh -T -o BatchMode=yes macbook-pro "~/.paper/bin/paper mcp"`, "macbook-pro"],
    [`/usr/bin/ssh -p 2222 edu@mbp13 paper mcp`, "mbp13"],
    [`"/Users/edu/.paper/bin/paper" mcp`, null],
  ])("reads the host from %s", (command, host) => {
    expect(sshHost(command)).toBe(host);
  });
});

describe("replyMessage", () => {
  it("reads plain JSON and the last data line of an event stream", () => {
    expect(replyMessage(`{"id":1,"result":{}}`)).toEqual({ id: 1, result: {} });
    expect(replyMessage(`event: message\ndata: {"id":2}\n\ndata: {"id":3}\n`)).toEqual({ id: 3 });
    expect(replyMessage("not json")).toBeNull();
  });
});

describe("emailFromJwt", () => {
  it("reads the email claim and ignores anything else", () => {
    const payload = Buffer.from(JSON.stringify({ email: "edu@example.com" })).toString("base64url");
    expect(emailFromJwt(`h.${payload}.s`)).toBe("edu@example.com");
    expect(emailFromJwt("not-a-jwt")).toBeNull();
    expect(emailFromJwt(undefined)).toBeNull();
  });
});

describe("isDeletedFrame", () => {
  it.each([
    [{ id: "X2-0", parentId: "root_node_p-1-0", childCount: 3 }, false],
    [{ id: "2UA-2", parentId: null, childCount: 0 }, true],
    [`Node not found: "2UA-2". The node may have been deleted, the ID is incorrect.`, true],
    ["Paper is busy, try again.", false],
  ])("reads %j", (node, deleted) => {
    expect(isDeletedFrame(node)).toBe(deleted);
  });
});
