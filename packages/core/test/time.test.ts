import { describe, expect, it } from "vitest";
import { addDays, collectRange, startOfLocalDay, xWeightedLength } from "../src/index.ts";

describe("采集时间范围", () => {
  it("previous_day：北京时间前一天 0:00 到当天 0:00", () => {
    const r = collectRange({ mode: "previous_day", timezone: "Asia/Shanghai", windowHours: 24 }, "2026-10-19", new Date("2026-10-18T23:30:00Z"));
    expect(r.contentDate).toBe("2026-10-18");
    expect(r.since.toISOString()).toBe("2026-10-17T16:00:00.000Z");
    expect(r.until.toISOString()).toBe("2026-10-18T16:00:00.000Z");
  });

  it("rolling：此刻往前 N 小时", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    const r = collectRange({ mode: "rolling", timezone: "Asia/Shanghai", windowHours: 24 }, "2026-10-18", now);
    expect(r.since.toISOString()).toBe("2026-10-17T10:00:00.000Z");
    expect(r.until).toBe(now);
  });

  it("跨月和有夏令时的时区", () => {
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(startOfLocalDay("2026-07-01", "America/Los_Angeles").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(startOfLocalDay("2026-12-01", "America/Los_Angeles").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });
});

describe("X 加权字数", () => {
  it("中文记 2、英文记 1、链接记 23", () => {
    expect(xWeightedLength("abc")).toBe(3);
    expect(xWeightedLength("中文")).toBe(4);
    expect(xWeightedLength("see https://example.com/very/long/path")).toBe(4 + 23);
  });
});
