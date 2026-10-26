import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readInbox } from "../src/inbox.ts";

describe("readInbox", () => {
  it("跳过采集控制文件（plan / progress / detail-needed / ratelimit），只读账号文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "inbox-"));
    for (const name of ["plan.json", "progress.json", "detail-needed.json", "ratelimit.json"]) writeFileSync(join(dir, name), JSON.stringify({ steps: [] }));
    writeFileSync(
      join(dir, "someone.json"),
      JSON.stringify({ source: "tencent-browser-skill", collectedAt: "2026-10-19T22:31:00Z", handle: "someone", status: "ok", tweets: [] }),
    );
    const r = readInbox("2026-10-19", dir);
    expect(r.invalid).toEqual([]);
    expect(r.files.map((f) => f.handle)).toEqual(["someone"]);
  });
});
