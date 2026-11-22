# 精选晨报 · OpenMotion 宣传 Demo

这是「精选晨报（twitter-rss）」的轻量宣传设计 Demo，不是线上官网，也不是产品功能改动。

设计叙事来自用户已发布的公众号文章：[AI精选晨报：每天看 X 上 100 位博主发布了什么](https://mp.weixin.qq.com/s/V6outUDQf_IwHUeVIxiU8A)。重点从“功能清单”改成文章里的漏斗与分发逻辑：

> 几百条 X 推文 → 8 步过滤漏斗 → 每天 30–60 条 → 邮件 + RSS 多处分发。

## 先看

- 本地预览页：[index.html](index.html)
- Hero MP4：[hero/hero-loop.mp4](hero/hero-loop.mp4)
- Hero GIF：[hero/hero-loop.gif](hero/hero-loop.gif)
- Hero 海报：[hero/hero-poster.png](hero/hero-poster.png)
- 三张卡片：[cards/cards-contact-sheet.png](cards/cards-contact-sheet.png)

启动本地预览：

```bash
cd brand-assets/openmotion-demo
python3 -m http.server 8088
# 打开 http://127.0.0.1:8088/
```

## 产物

| 文件 | 规格 | 说明 |
|---|---|---|
| `hero/hero-loop.mp4` | 1920×1080, 5.0s, 30fps, H.264, 静音 | OpenMotion 原生渲染 |
| `hero/hero-loop.gif` | 960×540, 5.0s, 12fps, 循环 | 由 MP4 转码，约 1.9MB |
| `hero/hero-poster.png` | 1920×1080 | 4.4s 落版帧 |
| `hero/hero-keyframes.png` | 1920×1080 | 0.5s / 2.3s / 3.35s / 4.4s 四个关键帧 |
| `cards/card-01.png` | 1080×1440 | 问题与承诺 |
| `cards/card-02.png` | 1080×1440 | “不是爬虫”的精选系统 |
| `cards/card-03.png` | 1080×1440 | 一处采集、多处分发 + CTA |
| `cards/cards-contact-sheet.png` | 3240×1440 | 三张卡片横向拼图 |
| `preview/review-desktop-1440x900.png` | 1440×900 | 本地预览页桌面截图 |
| `preview/review-mobile-390x844.png` | 390×844 | 本地预览页移动截图 |
| `source/cards-standalone.html` | 单文件 HTML | OpenMotion Design Studio 导出 |
| `source/build_cards.py` | 构建脚本 | 从字体和两张文章素材生成内嵌资源的卡片 HTML |

## OpenMotion 工程

### Hero 原生视频

- 工程名：`精选晨报 · 漏斗 Hero Loop`
- projectId：`c211efeb-cd35-487b-935c-b1e6c00b2837`
- currentVersionId：`617504ed-1605-4351-8f96-553008902768`
- revision：`bb0bb1e5c173d7ed2459c0f8dd63a0793763ed2a036f069ea68dd36c96c56f2d`
- Studio 预览：<http://127.0.0.1:57498/?session=9c9acd0e-46f8-4880-b085-28789fac79e6&project=c211efeb-cd35-487b-935c-b1e6c00b2837#project/c211efeb-cd35-487b-935c-b1e6c00b2837>
- 原生导出任务：`6a6105d0-b10c-43d3-9b13-68cd136963bf`
- 导出校验：technical PASS，150 帧全解码，H.264 / yuv420p / 1920×1080 / 30fps / 5.00s / 0 音轨
- MP4 SHA-256：`68e4e15206ccdaeb7daf81836643dd9f40bd04b4ae4552f8409e98c63df1d589`

工程包含 4 个可编辑子场景：`compositions/noise.html`、`funnel.html`、`output.html`、`distribution.html`。

补充：MP4 导出并完成技术校验后，OpenMotion 自动关闭了当前 work；再次调用 `complete_generation` 返回 `WORK_CLOSED`。这没有影响已完成的 MP4、Studio 工程和本地产物。

### 三张卡片

- 工程名：`精选晨报 · 三张竖版宣传卡`
- projectId：`51e29cd5-a496-483c-9cb9-4dc5016b0b5c`
- currentVersionId：`6bbb11ad-8124-41b9-89a2-dda7fcd34056`
- revision：`68a18fc0be3eabcd034aa28d751325797b59b3bd901b30c533a2ecc2a6005c4e`
- Studio：<http://127.0.0.1:57498/?page=design&scene=projects&designProject=51e29cd5-a496-483c-9cb9-4dc5016b0b5c>
- 原始预览：<http://127.0.0.1:57498/motion-api/design/raw/51e29cd5-a496-483c-9cb9-4dc5016b0b5c/index.html>

## 验证记录

- `ffprobe`：MP4 为 `h264`, `1920×1080`, `30/1`, `5.000000s`，无音频流。
- `ffprobe`：GIF 为 `960×540`, `12/1`, 60 帧, `5.000000s`。
- `sips`：三张卡片均为 `1080×1440`；contact sheet 为 `3240×1440`；poster 为 `1920×1080`。
- Playwright 本地加载卡片 HTML：三张卡元素截图精确为 `1080×1440`，console errors 为 0。
- Playwright 本地预览页：桌面 1440×900、移动 390×844 均无横向溢出；4 张图片全部加载；视频 `readyState=4`、持续 `5s`、可自动播放；console errors 为 0。
- 已用 `read_image` 逐张检查 Hero 关键帧、poster、三张卡片和预览页截图：中文字形、漏斗层级、30–60 数字与 CTA 均可读。
- 本地预览页截图：`preview/review-desktop-1440x900.png`、`preview/review-mobile-390x844.png`。

## 内容口径

- 公众号文章标题和正文写“100 位博主”，但当前 `config/topics.yaml` 是 **5 个主题、74 个账号槽位**。本次 Demo 不把“100 位”放进主视觉；使用文章同样强调的“**几百条 → 30–60 条**”。
- “每天不到 1 元”是公众号文章发布时的 DeepSeek 用量口径，不是固定报价；卡片和预览页都保留了口径说明。
- 目前没有已验证的公开订阅地址，所以 CTA 只放 GitHub 仓库，不伪造“立即订阅”入口。
- 不写“永久免费”“实时”“100% 准确”“官方合作”“零遗漏”等未证明表述。
- 本 Demo 不使用 AIGC 生成图；Hero 的邮件卡片/订阅页视觉来自用户自己的公众号素材和真实页面截图，其余为代码原生图形。

## 复现

卡片源由脚本生成（内嵌字体和两张公众号素材，均为本地 data URI，不依赖运行时网络）：

```bash
python3 brand-assets/openmotion-demo/source/build_cards.py
```

Hero 的源文件在 OpenMotion 工程内，`README.md` 记录了 projectId 和 Studio 链接；不要直接编辑 `/Users/ray/OpenMotion/projects/...` 来绕过 Studio 版本历史。

重新生成 GIF：

```bash
ffmpeg -y -i brand-assets/openmotion-demo/hero/hero-loop.mp4 \
  -vf "fps=12,scale=960:540:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 brand-assets/openmotion-demo/hero/hero-loop.gif
```

重新生成 contact sheet：

```bash
ffmpeg -y -i card-01.png -i card-02.png -i card-03.png \
  -filter_complex '[0:v][1:v][2:v]hstack=inputs=3' \
  -frames:v 1 cards-contact-sheet.png
```

## 授权与素材

- Noto Sans SC：OFL，见 `source/fonts/NotoSansSC-OFL.txt`。
- JetBrains Mono：OFL，见 `source/fonts/JetBrainsMono-OFL.txt`。
- 邮件卡片叠放图与订阅页截图来自用户自己的公众号文章与项目页面；不含订阅者邮箱、后台数据或密钥。
- 当前仓库没有项目级 `LICENSE`，本目录的图片和视频仅用于本项目宣传 Demo，不构成对 `twitter-rss` 代码的额外授权。
