import { describe, expect, it } from "vitest";
import { cleanTweetText, largeImageUrl, looksTruncated, ownMedia } from "../src/text.ts";

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


describe("ownMedia", () => {
  it("去掉引用卡片的小缩略图，以及同一张图的其他尺寸", () => {
    const media = [
      { type: "photo", url: "https://pbs.twimg.com/media/HVA10JfW0AAVMt5?format=jpg&name=900x900" },
      { type: "video", url: "https://pbs.twimg.com/amplify_video_thumb/2112211805858836480/img/lpIJgnhBGDMo4rZ3.jpg" },
      { type: "video", url: "https://pbs.twimg.com/amplify_video_thumb/2112211805858836480/img/lpIJgnhBGDMo4rZ3?format=jpg&name=240x240" },
    ];
    expect(ownMedia(media).map((m) => m.type)).toEqual(["photo"]);
  });

  it("只有引用卡片缩略图时视频封面被去掉；自己的视频保留；重复的只留一个", () => {
    expect(ownMedia([{ url: "https://pbs.twimg.com/amplify_video_thumb/1/img/a?format=jpg&name=360x360" }])).toEqual([]);
    const own = { url: "https://pbs.twimg.com/amplify_video_thumb/2/img/b.jpg" };
    expect(ownMedia([own, { ...own }])).toEqual([own]);
    expect(ownMedia([{ url: "https://pbs.twimg.com/media/X?format=jpg&name=large" }])).toHaveLength(1);
  });
});

describe("ownMedia：去掉误收的引用卡片封面", () => {
  it("引用推文的视频封面（小尺寸）排在前面时，留下推文自己的视频", () => {
    // @ayi_ainotes 2112556199589642611：自己的视频是 Altman 访谈，引用的是 MiniMax 那条
    const media = [
      { type: "video", url: "https://pbs.twimg.com/amplify_video_thumb/2112519800911994880/img/YMH78TCGDidCHbLs?format=jpg&name=360x360" },
      { type: "video", url: "https://pbs.twimg.com/amplify_video_thumb/2112197835882110976/img/b2WD51uiwue_T6Ph.jpg" },
    ];
    expect(ownMedia(media).map((m) => m.url)).toEqual(["https://pbs.twimg.com/amplify_video_thumb/2112197835882110976/img/b2WD51uiwue_T6Ph.jpg"]);
  });

  it("同一张图的大尺寸也一并去掉；推文只有自己的图片时不再有视频", () => {
    // @ayi_ainotes 2112247404325974195：两张自己的图，视频是引用的苹果预告（第一帧是黑的）
    const media = [
      { type: "photo", url: "https://pbs.twimg.com/media/HVA10JfW0AAVMt5?format=jpg&name=900x900" },
      { type: "photo", url: "https://pbs.twimg.com/media/HVA10JpWsAAUF08?format=jpg&name=large" },
      { type: "video", url: "https://pbs.twimg.com/amplify_video_thumb/2112211805858836480/img/lpIJgnhBGDMo4rZ3.jpg" },
      { type: "video", url: "https://pbs.twimg.com/amplify_video_thumb/2112211805858836480/img/lpIJgnhBGDMo4rZ3?format=jpg&name=240x240" },
    ];
    expect(ownMedia(media).map((m) => m.type)).toEqual(["photo", "photo"]);
  });

  it("重复的只留一个，正常尺寸不受影响", () => {
    const own = { url: "https://pbs.twimg.com/amplify_video_thumb/2/img/b.jpg" };
    expect(ownMedia([own, { ...own }])).toEqual([own]);
    expect(ownMedia([{ url: "https://pbs.twimg.com/media/X?format=jpg&name=large" }])).toHaveLength(1);
  });
});
