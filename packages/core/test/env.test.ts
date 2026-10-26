import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/index.ts";

describe("读取 .env", () => {
  const dir = mkdtempSync(join(tmpdir(), "xrss-env-"));
  const keys = ["LLM_API_KEY", "XRSS_TEST_OTHER", "XRSS_TEST_NEW"];
  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it("LLM_API_KEY 以 .env 为准，其他已存在的环境变量不覆盖", () => {
    const file = join(dir, ".env");
    writeFileSync(file, "LLM_API_KEY=new\nLLM_API_KEY=dup\nXRSS_TEST_OTHER=x\nXRSS_TEST_NEW=n\n");
    process.env.LLM_API_KEY = "old";
    process.env.XRSS_TEST_OTHER = "y";
    loadDotEnv(file);
    expect(process.env.LLM_API_KEY).toBe("new");
    expect(process.env.XRSS_TEST_OTHER).toBe("y");
    expect(process.env.XRSS_TEST_NEW).toBe("n");
    rmSync(dir, { recursive: true, force: true });
  });
});
