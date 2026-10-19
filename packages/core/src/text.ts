import { xWeightedLength } from "./scoring.ts";

/**
 * 修复从页面读取推文时（拿不到网络响应时的退路）带进来的断行：
 * X 的链接、@账号、#话题在页面上是单独的元素，按显示文本读取时前后会多出换行，
 * 例如 "https://\nanthropic.com/research/expec\ntations-for-the-future\n…" 或 "Optimized for\n@DeepSeekHarness\n, Tencent"。
 * 正常的网络响应文本不受影响。
 */
export function cleanTweetText(text: string): string {
  if (!text) return text;
  let s = text;
  // 链接：协议、显示部分、被折叠的剩余部分和省略号拼回完整地址
  s = s.replace(/(https?:\/\/)\n(\S+)(?:\n([^\s…]+))?\n?…/g, (_, proto: string, a: string, b?: string) => `${proto}${a}${b ?? ""}`);
  s = s.replace(/(https?:\/\/)[ \n]+(\S+)/g, "$1$2");
  // 行内的 @账号、#话题、$代码：前后的断行改成空格
  s = s.replace(/([^\n])\n([@#$][\p{L}\p{N}_]+)(?=\n[^\n]|$)/gu, "$1 $2");
  s = s.replace(/(^|[ \n])([@#$][\p{L}\p{N}_]+)\n(?=[^\n])/gu, "$1$2 ");
  // 拼接后标点前多出来的空格
  s = s.replace(/ +([,，.。:：;；!！?？)）])/g, "$1");
  return s;
}

/** 推文图片的大图地址（邮件里点开看清楚） */
export function largeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "pbs.twimg.com" || !u.pathname.startsWith("/media/")) return url;
    if (u.searchParams.has("name")) u.searchParams.set("name", "large");
    else {
      const m = /\.(jpe?g|png|webp)$/i.exec(u.pathname);
      if (m) {
        u.pathname = u.pathname.slice(0, -m[0].length);
        u.searchParams.set("format", m[1]!.toLowerCase() === "jpeg" ? "jpg" : m[1]!.toLowerCase());
      }
      u.searchParams.set("name", "large");
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * 引用推文的文字是否像被截断了：时间线里的引用推文只给前一部分，
 * 结尾停在冒号、逗号、"👇" 上，或者长度接近上限却没有句末标点。
 */
export function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[：:，,、👇⬇…]$/u.test(t)) return true;
  // 时间线里的引用推文大约在 100 个汉字 / 200 个英文字符处被截断
  return xWeightedLength(t) >= 200 && !/[。！？.!?)）」』"”'’\p{Extended_Pictographic}]$/u.test(t);
}
