/**
 * 内存里的滑动窗口计数（网站是单进程常驻，重启后清零）。
 * key 数量有上限：超出时先清掉过期的，仍然超出就丢掉最早的，伪造大量来源也不会让内存一直涨。
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }

  /** 窗口内已经到上限 */
  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.limit;
  }

  /** 记一次 */
  hit(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.delete(key);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(now);
  }

  /** 没到上限时记一次并返回 true；到上限返回 false（不记） */
  take(key: string, now = Date.now()): boolean {
    if (this.blocked(key, now)) return false;
    this.hit(key, now);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  get size(): number {
    return this.hits.size;
  }

  private prune(now: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
    // Map 按插入顺序遍历，最早的在前
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

/**
 * 访问者 IP：经 Cloudflare 时取 CF-Connecting-IP（Cloudflare 会覆盖，访问者伪造不了）；
 * 部署到 Vercel 等平台时取 X-Real-IP。不看 X-Forwarded-For：它的第一段是访问者自己能填的。
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  return h.get("cf-connecting-ip")?.trim() || h.get("x-real-ip")?.trim() || "local";
}
