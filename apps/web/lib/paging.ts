/** 长表格分页：?page=N（从 1 开始），超出范围时取最近的一页 */
export interface Page<T> {
  rows: T[];
  page: number;
  pages: number;
  total: number;
  size: number;
}

export function paginate<T>(items: T[], page: string | undefined, size: number): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const n = Math.min(pages, Math.max(1, Number.parseInt(page ?? "1", 10) || 1));
  return { rows: items.slice((n - 1) * size, n * size), page: n, pages, total: items.length, size };
}

/** 在当前查询参数上改一个参数，生成链接；值为空或默认值时去掉这个参数 */
export function withParam(path: string, params: Record<string, string | undefined>, key: string, value: string | undefined, fallback?: string): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, [key]: value })) if (v && !(k === key && v === fallback)) s.set(k, v);
  const qs = s.toString();
  return qs ? `${path}?${qs}` : path;
}
