/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { DigestView } from "@xrss/core";
import {
  CONTENT_WIDTH,
  color,
  font,
  MAIL_WIDTH,
  MOBILE_BREAKPOINT,
} from "./theme.ts";
import { CompactItem, TweetCard } from "./TweetCard.tsx";

/**
 * 长推文原文折叠（纯 CSS）：页面开头有一个默认选中的单选按钮 .xs，它存在说明邮箱保留了表单元素、支持 :checked，
 * 这时才隐藏原文、显示"展开原文"。Gmail 等会删掉表单元素，规则不生效，原文照常显示。
 */
const foldCss = [
  ".xr-in,.xs{display:none!important}",
  ".xs:checked ~ .xs-root .xr-l{display:inline-block!important;max-height:none!important}",
  ".xs:checked ~ .xs-root .xr-body{display:none}",
  ".xs:checked ~ .xs-root .xr-in:checked ~ .xr-body{display:block!important}",
  ".xr-c{display:none}",
  ".xr-in:checked ~ .xr-l .xr-o{display:none}",
  ".xr-in:checked ~ .xr-l .xr-c{display:inline}",
].join("\n");

/**
 * 推文图片（纯 CSS，同样依赖 .xs 检测）：
 * - 多图：左右滑动的横条，按张吸附，露出下一张的边缘提示还能滑
 * - 点图：隐藏的复选框打开全屏放大层，点任意处关闭；大图是背景图，打开时才下载
 * 不支持的邮箱规则不生效，图片一张一行，点图打开大图文件。
 */
const S = ".xs:checked ~ .xs-root";
const mediaCss = [
  ".xi-in{display:none!important}",
  `${S} .xi-a{pointer-events:none}`,
  `${S} .xi-l{cursor:zoom-in}`,
  `${S} .xgm{display:flex!important;overflow-x:auto;scroll-snap-type:x mandatory;width:${CONTENT_WIDTH}px;max-width:calc(100vw - 40px);margin-top:14px}`,
  `${S} .xgm .xgi{flex:0 0 82%;scroll-snap-align:start;margin:0 8px 0 0!important}`,
  `${S} .xgm .xgi img{height:260px!important;width:100%!important;object-fit:cover}`,
  `${S} .xg-tip{display:block!important}`,
  `${S} .xi-in:checked ~ .xi-box{display:block!important;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,.92);cursor:zoom-out}`,
  ".xi-big{position:absolute;top:40px;left:12px;right:12px;bottom:48px;background-size:contain;background-position:center;background-repeat:no-repeat}",
  ".xi-tip{position:absolute;left:0;right:0;bottom:16px;text-align:center;color:#C9CDD3;font-size:13px}",
].join("\n");

/**
 * 主题标签页（纯 CSS：隐藏的单选按钮 + :checked）。
 * 支持的邮箱（如苹果邮件）点标签切换主题；不支持或删掉表单元素的邮箱（如 Gmail），
 * 标签栏保持隐藏，显示原来的主题目录，各主题依次展开，和不开标签页时一样。
 */
function tabsCss(topicColors: string[]): string {
  const ids = topicColors.map((_, i) => i + 1);
  // 选中项：深色粗体，下划线用该主题的颜色（和正文里主题标题下的色线一致）
  const active = (c: string) =>
    `color:${color.ink}!important;font-weight:700!important;border-bottom-color:${c}!important`;
  return [
    ".xt-in{display:none!important}",
    ".xt-in:checked ~ .xt-bar{display:block!important;max-height:none!important;overflow:visible!important}",
    ".xt-in:checked ~ .xt-toc{display:none!important}",
    ".xt-in:checked ~ .xt-probe .xt-yes{display:block!important;max-height:none!important}",
    ".xt-in:checked ~ .xt-probe .xt-no{display:none!important}",
    `#xt-all:checked ~ .xt-bar .xt-l-all{${active(color.ink)}}`,
    ...ids.flatMap((i) => [
      `#xt-${i}:checked ~ .xt-panels .xt-p{display:none!important}`,
      `#xt-${i}:checked ~ .xt-panels .xt-p-${i}{display:block!important}`,
      `#xt-${i}:checked ~ .xt-bar .xt-l-${i}{${active(topicColors[i - 1]!)}}`,
    ]),
    ".xt-l{cursor:pointer}",
    // 手机上标签栏不换行，左右滑动（只在支持标签页的邮箱里出现，例如 iPhone 邮件）
    `@media (max-width:${MOBILE_BREAKPOINT}px){.xt-bar .xnr{white-space:nowrap!important;overflow-x:auto!important;max-width:calc(100vw - 40px)!important;-webkit-overflow-scrolling:touch}.xt-bar .xt-l{margin-right:16px!important}}`,
  ].join("\n");
}

// 主题切换：浅灰底的圆角按钮，选中时深色
// 主题导航：一行纯文字链接（不用色块按钮），换行时读起来仍是文字，不会堆成几排方块
const tabLabel = {
  display: "inline-block",
  padding: "6px 0 5px",
  margin: "0 20px 0 0",
  fontSize: 14,
  lineHeight: "20px",
  color: color.muted,
  borderBottom: "2px solid transparent",
  textDecoration: "none",
  whiteSpace: "nowrap",
} as const;

/** 导航项：主题名 + 浅色条数 */
const navText = (name: string, count: number) => (
  <>
    {name}
    <span style={{ color: color.faint, marginLeft: 4 }}>{count}</span>
  </>
);

/** 导航外层：下方一条细线，和正文分开 */
const navRow = {
  borderBottom: `1px solid ${color.line}`,
  lineHeight: "20px",
} as const;

export function DailyDigest({
  view,
  tabs = false,
  probe = false,
}: {
  view: DigestView;
  tabs?: boolean;
  probe?: boolean;
}) {
  const preview = view.groups
    .flatMap((g) => g.items)
    .slice(0, 2)
    .map((c) => `${c.author.name}：${c.parts[0]?.slice(0, 40) ?? ""}`)
    .join(" / ");

  return (
    <Html lang={view.lang === "zh" ? "zh-CN" : "en"}>
      <Head>
        {/* 没有 viewport 时 iPhone 邮件按桌面宽度排版，手机样式不会生效 */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* 手机和窄窗口：左右留白 32→20px，标题小一号 */}
        <style
          dangerouslySetInnerHTML={{
            __html: `body{margin:0!important}@media (max-width:${MOBILE_BREAKPOINT}px){.xc{padding-left:20px!important;padding-right:20px!important}.xn{padding:10px 12px!important}.xh{font-size:22px!important;line-height:30px!important}}\n${foldCss}\n${mediaCss}${tabs ? `\n${tabsCss(view.groups.map((g) => g.topic.color))}` : ""}`,
          }}
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: color.ground,
          fontFamily: font.sans,
          color: color.ink,
          margin: 0,
          padding: 0,
          WebkitTextSizeAdjust: "100%",
        }}
      >
        <Container
          style={{
            width: "100%",
            maxWidth: MAIL_WIDTH,
            backgroundColor: color.card,
            fontFamily: font.sans,
          }}
        >
          {/* 检测邮箱是否支持 :checked，见 foldCss */}
          <input
            type="radio"
            className="xs"
            defaultChecked
            style={{ display: "none", msoHide: "all" } as React.CSSProperties}
          />
          <div className="xs-root">
            {/* 头部 */}
            <Section className="xc" style={{ padding: "28px 32px 20px" }}>
              <Row>
                <Column>
                  <span
                    style={{
                      display: "inline-block",
                      width: 26,
                      height: 26,
                      lineHeight: "26px",
                      borderRadius: 6,
                      backgroundColor: color.ink,
                      color: "#FFFFFF",
                      fontWeight: 900,
                      fontSize: 15,
                      textAlign: "center",
                      verticalAlign: "middle",
                    }}
                  >
                    X
                  </span>
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: color.ink,
                      marginLeft: 8,
                      verticalAlign: "middle",
                    }}
                  >
                    精选晨报
                  </span>
                </Column>
                <Column align="right">
                  <Text style={{ fontSize: 13, color: color.muted, margin: 0 }}>
                    {view.dateLabel}
                  </Text>
                </Column>
              </Row>
              <Text
                className="xh"
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  lineHeight: "34px",
                  color: color.ink,
                  margin: "20px 0 8px",
                }}
              >
                {view.periodLabel
                  ? `${view.periodLabel}值得读的 ${view.total} 条`
                  : `今天值得读的 ${view.total} 条`}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: "22px",
                  color: color.muted,
                  margin: "0 0 16px",
                }}
              >
                来自你订阅的 {view.topicCount} 个主题、{view.accountCount} 位
                X（原 Twitter）博主 · 从
                {view.periodLabel ? `${view.periodLabel}发布的 ` : " "}
                {view.scannedCount} 条新推文中筛选
                {view.lang === "zh" ? " · 中文版（AI 翻译）" : " · 原文版"}
              </Text>
              {tabs ? null : (
                <div style={navRow}>
                  {view.groups.map((g, i) => (
                    <a
                      key={g.topic.id}
                      href={`#xt-p-${i + 1}`}
                      style={tabLabel}
                    >
                      {navText(
                        g.topic.name,
                        g.items.length + (g.compact?.length ?? 0),
                      )}
                    </a>
                  ))}
                </div>
              )}
            </Section>

            {tabs ? (
              <div>
                <input
                  type="radio"
                  name="xt"
                  id="xt-all"
                  className="xt-in"
                  defaultChecked
                  style={
                    { display: "none", msoHide: "all" } as React.CSSProperties
                  }
                />
                {view.groups.map((g, i) => (
                  <input
                    key={g.topic.id}
                    type="radio"
                    name="xt"
                    id={`xt-${i + 1}`}
                    className="xt-in"
                    style={
                      { display: "none", msoHide: "all" } as React.CSSProperties
                    }
                  />
                ))}
                {probe ? (
                  <div
                    className="xt-probe"
                    style={{
                      margin: "0 32px 12px",
                      padding: "12px 16px",
                      borderRadius: 8,
                      backgroundColor: color.note,
                      fontSize: 13,
                      lineHeight: "20px",
                    }}
                  >
                    <div
                      className="xt-yes"
                      style={
                        {
                          display: "none",
                          maxHeight: 0,
                          overflow: "hidden",
                          color: "#22663D",
                          fontWeight: 700,
                        } as React.CSSProperties
                      }
                    >
                      ✓ 这个邮箱支持标签页：点下面的主题可以切换
                    </div>
                    <div
                      className="xt-no"
                      style={{ color: "#8A5300", fontWeight: 700 }}
                    >
                      ✗ 这个邮箱不支持标签页：各主题依次排列，点主题名可跳转
                    </div>
                  </div>
                ) : null}
                {/* 标签栏：默认隐藏，支持的邮箱才显示 */}
                <div
                  className="xt-bar xc"
                  style={
                    {
                      display: "none",
                      maxHeight: 0,
                      overflow: "hidden",
                      padding: "0 32px",
                      msoHide: "all",
                    } as React.CSSProperties
                  }
                >
                  <div className="xnr" style={navRow}>
                    <label
                      htmlFor="xt-all"
                      className="xt-l xt-l-all"
                      style={tabLabel}
                    >
                      {navText("全部", view.total)}
                    </label>
                    {view.groups.map((g, i) => (
                      <label
                        key={g.topic.id}
                        htmlFor={`xt-${i + 1}`}
                        className={`xt-l xt-l-${i + 1}`}
                        style={tabLabel}
                      >
                        {navText(
                          g.topic.name,
                          g.items.length + (g.compact?.length ?? 0),
                        )}
                      </label>
                    ))}
                  </div>
                </div>
                {/* 目录：不支持标签页的邮箱显示，点击跳到对应主题 */}
                <div className="xt-toc xc" style={{ padding: "0 32px" }}>
                  <div style={navRow}>
                    {view.groups.map((g, i) => (
                      <a
                        key={g.topic.id}
                        href={`#xt-p-${i + 1}`}
                        style={tabLabel}
                      >
                        {navText(
                          g.topic.name,
                          g.items.length + (g.compact?.length ?? 0),
                        )}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="xt-panels">
                  {view.groups.map((g, i) => (
                    <div
                      key={g.topic.id}
                      id={`xt-p-${i + 1}`}
                      className={`xt-p xt-p-${i + 1}`}
                    >
                      <TopicSection group={g} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              view.groups.map((g, i) => (
                <div key={g.topic.id} id={`xt-p-${i + 1}`}>
                  <TopicSection group={g} />
                </div>
              ))
            )}

            {/* 页脚 */}
            <Section
              className="xc"
              style={{
                backgroundColor: color.footer,
                padding: "24px 32px 28px",
                marginTop: 24,
                textAlign: "center",
              }}
            >
              <Text style={{ fontSize: 13, margin: "0 0 8px" }}>
                <Link href={view.links.manage} style={{ color: color.link }}>
                  管理订阅主题
                </Link>
                {"　"}
                <Link
                  href={view.links.switchLang}
                  style={{ color: color.link }}
                >
                  {view.lang === "zh" ? "改为接收原文" : "改为接收中文"}
                </Link>
                {"　"}
                <Link href={view.links.rss} style={{ color: color.link }}>
                  RSS 订阅
                </Link>
                {"　"}
                <Link
                  href={view.links.unsubscribe}
                  style={{ color: color.link }}
                >
                  退订
                </Link>
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: "20px",
                  color: color.muted,
                  margin: 0,
                }}
              >
                {view.personalLinks ? null : (
                  <>
                    修改设置或退订时，在打开的页面输入你的邮箱，我们会把专属链接发给你
                    <br />
                  </>
                )}
                内容版权归原作者所有 · 翻译与视频说明由 AI 生成，可能有误
                <br />
                你收到这封邮件是因为订阅了精选晨报
              </Text>
            </Section>
          </div>
        </Container>
      </Body>
    </Html>
  );
}

function TopicSection({ group: g }: { group: DigestView["groups"][number] }) {
  return (
    <div>
      {/* 主题标题：不用多列表格，避免部分网页邮箱把标题挤成竖排 */}
      {/* 主题标题：主题色粗线 + 名称和条数，像书的章节开头 */}
      <div className="xc" style={{ padding: "28px 32px 0" }}>
        <p
          style={{
            fontSize: 20,
            fontWeight: 800,
            lineHeight: "28px",
            color: color.ink,
            margin: 0,
            paddingBottom: 10,
            borderBottom: `3px solid ${g.topic.color}`,
          }}
        >
          {g.topic.name}
          <span
            style={{ fontSize: 14, fontWeight: 400, color: color.muted }}
          >{`　${g.items.length + (g.compact?.length ?? 0)} 条`}</span>
        </p>
      </div>
      {g.items.map((card, i) => (
        <TweetCard
          key={card.id}
          card={card}
          last={i === g.items.length - 1 && !g.compact?.length}
        />
      ))}
      {g.compact?.length ? (
        <div
          className="xc"
          style={{
            padding: "20px 32px 8px",
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: color.muted,
              margin: "0 0 12px",
            }}
          >
            还有 {g.compact.length} 条，篇幅所限只列摘要
          </p>
          {g.compact.map((card) => (
            <CompactItem key={card.id} card={card} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
