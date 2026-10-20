/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import { Body, Column, Container, Head, Html, Link, Preview, Row, Section, Text } from "@react-email/components";
import type { DigestView } from "@xrss/core";
import { color, font, MAIL_WIDTH } from "./theme.ts";
import { CompactItem, TweetCard } from "./TweetCard.tsx";

/**
 * 主题标签页（纯 CSS：隐藏的单选按钮 + :checked）。
 * 支持的邮箱（如苹果邮件）点标签切换主题；不支持或删掉表单元素的邮箱（如 Gmail），
 * 标签栏保持隐藏，显示原来的主题目录，各主题依次展开，和不开标签页时一样。
 */
function tabsCss(count: number): string {
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const active = `background:${color.ink}!important;color:#FFFFFF!important;border-color:${color.ink}!important`;
  return [
    ".xt-in{display:none!important}",
    ".xt-in:checked ~ .xt-bar{display:block!important;max-height:none!important;overflow:visible!important}",
    ".xt-in:checked ~ .xt-toc{display:none!important}",
    ".xt-in:checked ~ .xt-probe .xt-yes{display:block!important;max-height:none!important}",
    ".xt-in:checked ~ .xt-probe .xt-no{display:none!important}",
    `#xt-all:checked ~ .xt-bar .xt-l-all{${active}}`,
    ...ids.flatMap((i) => [
      `#xt-${i}:checked ~ .xt-panels .xt-p{display:none!important}`,
      `#xt-${i}:checked ~ .xt-panels .xt-p-${i}{display:block!important}`,
      `#xt-${i}:checked ~ .xt-bar .xt-l-${i}{${active}}`,
    ]),
    ".xt-l{cursor:pointer}",
  ].join("\n");
}

// 仿 X 的胶囊按钮：描边、粗体，选中时黑底白字
const tabLabel = {
  display: "inline-block",
  border: `1px solid ${color.frame}`,
  borderRadius: 999,
  padding: "5px 14px",
  margin: "0 6px 8px 0",
  fontSize: 14,
  lineHeight: "20px",
  fontWeight: 700,
  color: color.ink,
  backgroundColor: "#FFFFFF",
} as const;

const dot = (c: string) => <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, backgroundColor: c, marginRight: 6, verticalAlign: "1px" }} />;

export function DailyDigest({ view, tabs = false, probe = false }: { view: DigestView; tabs?: boolean; probe?: boolean }) {
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
        {/* 600px 以下（手机、窄窗口）：去掉外框和灰底、铺满屏幕，左右留白和头像间距收窄，标题小一号 */}
        <style dangerouslySetInnerHTML={{ __html: `body{margin:0!important}@media (max-width:600px){.xb,.xb>table>tbody>tr>td{padding:0!important;background-color:#FFFFFF!important}.xw{border:0!important;border-radius:0!important;max-width:100%!important}.xc{padding-left:12px!important;padding-right:12px!important}.xa{width:48px!important;min-width:48px!important}.xa3{width:27px!important;min-width:27px!important}.xq{padding:10px!important}.xh{font-size:20px!important;line-height:26px!important}}${tabs ? `\n${tabsCss(view.groups.length)}` : ""}` }} />
      </Head>
      <Preview>{preview}</Preview>
      <Body className="xb" style={{ backgroundColor: color.ground, fontFamily: font.sans, color: color.ink, margin: 0, padding: "16px 0", WebkitTextSizeAdjust: "100%" }}>
        <Container className="xw" style={{ width: "100%", maxWidth: MAIL_WIDTH, backgroundColor: color.card, border: `1px solid ${color.line}`, borderRadius: 16, overflow: "hidden", fontFamily: font.sans }}>
          {/* 头部 */}
          <Section className="xc" style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${color.line}` }}>
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
                <span style={{ fontSize: 17, fontWeight: 800, color: color.ink, marginLeft: 8, verticalAlign: "middle" }}>精选晨报</span>
              </Column>
              <Column align="right">
                <Text style={{ fontSize: 13, color: color.muted, margin: 0 }}>{view.dateLabel}</Text>
              </Column>
            </Row>
            <Text className="xh" style={{ fontSize: 23, fontWeight: 800, lineHeight: "28px", color: color.ink, margin: "16px 0 4px" }}>{view.periodLabel ? `${view.periodLabel}值得读的 ${view.total} 条` : `今天值得读的 ${view.total} 条`}</Text>
            <Text style={{ fontSize: 15, lineHeight: "20px", color: color.muted, margin: "0 0 12px" }}>
              来自你订阅的 {view.topicCount} 个主题、{view.accountCount} 位 X（原 Twitter）博主 · 从{view.periodLabel ? `${view.periodLabel}发布的 ` : " "}{view.scannedCount} 条新推文中筛选
              {view.lang === "zh" ? " · 中文版（AI 翻译）" : " · 原文版"}
            </Text>
            {tabs ? null : (
              <div>
                {view.groups.map((g) => (
                  <span key={g.topic.id} style={tabLabel}>
                    {dot(g.topic.color)}
                    {g.topic.name} {g.items.length + (g.compact?.length ?? 0)}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {tabs ? (
            <div>
              <input type="radio" name="xt" id="xt-all" className="xt-in" defaultChecked style={{ display: "none", msoHide: "all" } as React.CSSProperties} />
              {view.groups.map((g, i) => (
                <input key={g.topic.id} type="radio" name="xt" id={`xt-${i + 1}`} className="xt-in" style={{ display: "none", msoHide: "all" } as React.CSSProperties} />
              ))}
              {probe ? (
                <div className="xt-probe" style={{ margin: "12px 16px 0", padding: "12px 16px", borderRadius: 16, backgroundColor: color.note, fontSize: 13, lineHeight: "20px" }}>
                  <div className="xt-yes" style={{ display: "none", maxHeight: 0, overflow: "hidden", color: "#22663D", fontWeight: 700 } as React.CSSProperties}>
                    ✓ 这个邮箱支持标签页：点下面的主题可以切换
                  </div>
                  <div className="xt-no" style={{ color: "#8A5300", fontWeight: 700 }}>
                    ✗ 这个邮箱不支持标签页：各主题依次排列，点主题名可跳转
                  </div>
                </div>
              ) : null}
              {/* 标签栏：默认隐藏，支持的邮箱才显示 */}
              <div className="xt-bar xc" style={{ display: "none", maxHeight: 0, overflow: "hidden", padding: "12px 16px 4px", borderBottom: `1px solid ${color.line}`, msoHide: "all" } as React.CSSProperties}>
                <label htmlFor="xt-all" className="xt-l xt-l-all" style={tabLabel}>
                  全部 {view.total}
                </label>
                {view.groups.map((g, i) => (
                  <label key={g.topic.id} htmlFor={`xt-${i + 1}`} className={`xt-l xt-l-${i + 1}`} style={tabLabel}>
                    {dot(g.topic.color)}
                    {g.topic.name} {g.items.length + (g.compact?.length ?? 0)}
                  </label>
                ))}
              </div>
              {/* 目录：不支持标签页的邮箱显示，点击跳到对应主题 */}
              <div className="xt-toc xc" style={{ padding: "12px 16px 4px", borderBottom: `1px solid ${color.line}` }}>
                {view.groups.map((g, i) => (
                  <a key={g.topic.id} href={`#xt-p-${i + 1}`} style={{ ...tabLabel, textDecoration: "none" }}>
                    {dot(g.topic.color)}
                    {g.topic.name} {g.items.length + (g.compact?.length ?? 0)}
                  </a>
                ))}
              </div>
              <div className="xt-panels">
                {view.groups.map((g, i) => (
                  <div key={g.topic.id} id={`xt-p-${i + 1}`} className={`xt-p xt-p-${i + 1}`}>
                    <TopicSection group={g} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            view.groups.map((g) => <TopicSection key={g.topic.id} group={g} />)
          )}

          {/* 页脚 */}
          <Section className="xc" style={{ backgroundColor: color.footer, padding: "20px 16px 24px", borderTop: `1px solid ${color.line}`, textAlign: "center" }}>
            <Text style={{ fontSize: 13, margin: "0 0 8px" }}>
              <Link href={view.links.manage} style={{ color: color.link }}>管理订阅主题</Link>
              {"　"}
              <Link href={view.links.switchLang} style={{ color: color.link }}>{view.lang === "zh" ? "改为接收原文" : "改为接收中文"}</Link>
              {"　"}
              <Link href={view.links.rss} style={{ color: color.link }}>RSS 订阅</Link>
              {"　"}
              <Link href={view.links.unsubscribe} style={{ color: color.link }}>退订</Link>
            </Text>
            <Text style={{ fontSize: 13, lineHeight: "20px", color: color.muted, margin: 0 }}>
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
        </Container>
      </Body>
    </Html>
  );
}

function TopicSection({ group: g }: { group: DigestView["groups"][number] }) {
  return (
    <div>
      {/* 主题标题：不用多列表格，避免部分网页邮箱把标题挤成竖排 */}
      {/* 主题标题：仿 X 的分区标题（20px 粗体），左侧一条主题色竖条 */}
      <div className="xc" style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${color.line}`, backgroundColor: color.ground }}>
        <p style={{ fontSize: 20, fontWeight: 800, lineHeight: "24px", color: color.ink, margin: 0, borderLeft: `4px solid ${g.topic.color}`, paddingLeft: 10 }}>{g.topic.name}</p>
      </div>
      {g.items.map((card, i) => (
        <TweetCard key={card.id} card={card} last={i === g.items.length - 1 && !g.compact?.length} />
      ))}
      {g.compact?.length ? (
        <div className="xc" style={{ padding: "12px 16px 6px", borderTop: `1px solid ${color.line}` }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: color.muted, margin: "0 0 8px" }}>还有 {g.compact.length} 条，篇幅所限只列摘要</p>
          {g.compact.map((card) => (
            <CompactItem key={card.id} card={card} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
