import { describe, expect, it } from "vitest";
import { cleanTweetText, largeImageUrl, looksTruncated } from "../src/text.ts";

describe("cleanTweetText：修复页面读取带来的断行", () => {
  it("拼回被拆开的链接", () => {
    expect(cleanTweetText("博客：\nhttps://\nanthropic.com/research/expec\ntations-for-the-future\n…\n下一段")).toBe(
      "博客：\nhttps://anthropic.com/research/expectations-for-the-future\n下一段",
    );
    expect(cleanTweetText("模型下载：\nhttps://\nhuggingface.co/deepseek-ai/De\nepSeek-V4.1-Flash-1017\n…")).toBe("模型下载：\nhttps://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017");
    expect(cleanTweetText("看这里 https://\nexample.com/a")).toBe("看这里 https://example.com/a");
    expect(cleanTweetText("http:// github.com/Niko1221/Strata")).toBe("http://github.com/Niko1221/Strata");
  });

  it("行内的 @账号、#话题 不再单独占一行", () => {
    expect(cleanTweetText("🛠 Optimized for\n@DeepSeekHarness\n, Tencent CodeBuddy,")).toBe("🛠 Optimized for @DeepSeekHarness, Tencent CodeBuddy,");
    expect(cleanTweetText("感谢\n@karpathy\n的分享")).toBe("感谢 @karpathy 的分享");
    expect(cleanTweetText("话题\n#AI\n很热")).toBe("话题 #AI 很热");
  });

  it("正常文本不变", () => {
    const normal = "第一段\n\n第二段 https://example.com/a\n@someone 你好";
    expect(cleanTweetText(normal)).toBe(normal);
  });
});

describe("图片和截断", () => {
  it("推文图片换成大图地址", () => {
    expect(largeImageUrl("https://pbs.twimg.com/media/Abc.jpg")).toBe("https://pbs.twimg.com/media/Abc?format=jpg&name=large");
    expect(largeImageUrl("https://pbs.twimg.com/media/Abc?format=png&name=small")).toBe("https://pbs.twimg.com/media/Abc?format=png&name=large");
    expect(largeImageUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });

  it("识别被截断的引用", () => {
    expect(looksTruncated("其实Opus5.5整体还挺耐用的，但是需要对默认设置稍微做点调整：")).toBe(true);
    expect(looksTruncated("踩坑后的小技巧👇")).toBe(true);
    expect(looksTruncated("这是完整的一句话。")).toBe(false);
    expect(looksTruncated("这".repeat(130))).toBe(true);
    // 真实例子：时间线里的引用推文停在半句话
    expect(looksTruncated("这次 Rust 大会的主题是 Rust and AI。而 Rust 常被人诟病的一点是编译废 CPU、产物废磁盘，AI 堆 Rust 代码的速度也明显慢于其他语言。 但反过来想，这个“缺点”在当下可能恰恰是一个特性：一个项目如果选择用 Rust 开发，至少说明作者和 AI")).toBe(true);
    expect(looksTruncated("rust是个好语言，但大项目编译速度太慢")).toBe(false);
  });
});
