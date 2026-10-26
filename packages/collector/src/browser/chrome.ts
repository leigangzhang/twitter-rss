import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";

/**
 * 采集专用的 Chrome：用一个独立的用户资料（只登录采集小号），带调试端口正常启动，脚本通过调试端口连接。
 * 启动的就是本机安装的 Google Chrome，不带任何自动化启动参数，和手动打开的 Chrome 一样；
 * 日常用的 Chrome 资料（大号）完全不受影响。新版 Chrome 也不允许在默认资料上开调试端口，所以必须用独立资料。
 *
 * 可在 .env 里修改：
 *   XRSS_CHROME_PATH     Chrome 程序路径（默认 macOS 的 /Applications/Google Chrome.app）
 *   XRSS_CHROME_PROFILE  用户资料目录（默认 ~/.xrss-chrome）
 *   XRSS_CHROME_PORT     调试端口（默认 9333，只监听本机）
 *   XRSS_CHROME_ARGS     额外的启动参数，只用于测试（如在无界面的 Linux 上 --headless=new --no-sandbox），日常采集不要设置
 */
export interface ChromeOptions {
  path: string;
  profileDir: string;
  port: number;
  extraArgs: string[];
}

export function chromeOptions(env = process.env): ChromeOptions {
  return {
    path: env.XRSS_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    profileDir: env.XRSS_CHROME_PROFILE || join(homedir(), ".xrss-chrome"),
    port: Number(env.XRSS_CHROME_PORT || 9333),
    extraArgs: (env.XRSS_CHROME_ARGS || "").split(/\s+/).filter(Boolean),
  };
}

/** 启动参数：只有独立资料和本机调试端口，不加 --enable-automation 等自动化参数 */
export function chromeArgs(opts: ChromeOptions, url?: string): string[] {
  return [
    `--user-data-dir=${opts.profileDir}`,
    `--remote-debugging-port=${opts.port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    ...opts.extraArgs,
    ...(url ? [url] : []),
  ];
}

const endpoint = (opts: ChromeOptions) => `http://127.0.0.1:${opts.port}`;

async function isUp(opts: ChromeOptions): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint(opts)}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 采集用的 Chrome 没在运行就启动它（脱离当前进程，采集结束后继续开着，保持登录） */
export async function ensureChrome(opts = chromeOptions(), url?: string): Promise<{ started: boolean }> {
  if (await isUp(opts)) return { started: false };
  if (!existsSync(opts.path)) throw new Error(`找不到 Chrome：${opts.path}。请安装 Google Chrome，或在 .env 里设置 XRSS_CHROME_PATH`);
  mkdirSync(opts.profileDir, { recursive: true });
  const child = spawn(opts.path, chromeArgs(opts, url), { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isUp(opts)) return { started: true };
  }
  throw new Error(
    `Chrome 启动后 20 秒内调试端口 ${opts.port} 没有响应。如果这个资料的 Chrome 已经以普通方式打开着，请先完全退出它再运行`,
  );
}

export async function connectChrome(opts = chromeOptions()): Promise<Browser> {
  return chromium.connectOverCDP(endpoint(opts));
}
