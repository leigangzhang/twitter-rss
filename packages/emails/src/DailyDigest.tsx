/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import { Body, Column, Container, Head, Html, Link, Preview, Row, Section, Text } from "@react-email/components";
import type { DigestView } from "@xrss/core";
import { color, font } from "./theme.ts";
import { TweetCard } from "./TweetCard.tsx";

export function DailyDigest({ view }: { view: DigestView }) {
  const preview = view.groups
    .flatMap((g) => g.items)
    .slice(0, 2)
    .map((c) => `${c.author.name}：${c.parts[0]?.slice(0, 40) ?? ""}`)
    .join(" / ");

  return (
    <Html lang={view.lang === "zh" ? "zh-CN" : "en"}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: color.ground, fontFamily: font.sans, margin: 0, padding: "20px 0" }}>
        <Container style={{ width: "100%", maxWidth: 640, backgroundColor: color.card, borderRadius: 14, overflow: "hidden" }}>
          {/* 头部 */}
          <Section style={{ padding: "34px 36px 26px", borderBottom: `1px solid ${color.line}` }}>
            <Row>
              <Column>
                <span
                  style={{
                    display: "inline-block",
                    width: 28,
                    height: 28,
                    lineHeight: "28px",
                    borderRadius: 7,
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
                <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.5px", color: color.ink, marginLeft: 10, verticalAlign: "middle" }}>精选晨报</span>
              </Column>
              <Column align="right">
                <Text style={{ fontFamily: font.mono, fontSize: 12, color: color.muted, margin: 0 }}>{view.dateLabel}</Text>
              </Column>
            </Row>
            <Text style={{ fontSize: 30, fontWeight: 900, lineHeight: "39px", color: color.ink, margin: "18px 0 8px" }}>{view.periodLabel ? `${view.periodLabel}值得读的 ${view.total} 条` : `今天值得读的 ${view.total} 条`}</Text>
            <Text style={{ fontSize: 14, lineHeight: "22px", color: color.muted, margin: "0 0 16px" }}>
              来自你订阅的 {view.topicCount} 个主题、{view.accountCount} 位 X（原 Twitter）博主 · 从{view.periodLabel ? `${view.periodLabel}发布的 ` : " "}{view.scannedCount} 条新推文中筛选
              {view.lang === "zh" ? " · 中文版（AI 翻译）" : " · 原文版"}
            </Text>
            <Text style={{ margin: 0, lineHeight: "34px" }}>
              {view.groups.map((g) => (
                <span
                  key={g.topic.id}
                  style={{ display: "inline-block", border: `1px solid ${color.line}`, borderRadius: 999, padding: "4px 12px", fontSize: 13, color: color.body, marginRight: 8 }}
                >
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, backgroundColor: g.topic.color, marginRight: 6 }} />
                  {g.topic.name} {g.items.length}
                </span>
              ))}
            </Text>
          </Section>

          {/* 各主题 */}
          {view.groups.map((g) => (
            <Section key={g.topic.id}>
              <Section style={{ padding: "26px 36px 4px" }}>
                <Row>
                  <Column style={{ width: 20 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, backgroundColor: g.topic.color }} />
                  </Column>
                  <Column style={{ whiteSpace: "nowrap", width: 1, paddingRight: 12 }}>
                    <Text style={{ fontSize: 13, fontWeight: 700, letterSpacing: "2px", color: g.topic.color, margin: 0 }}>{g.topic.name}</Text>
                  </Column>
                  <Column>
                    <div style={{ height: 1, backgroundColor: color.line }} />
                  </Column>
                </Row>
              </Section>
              {g.items.map((card, i) => (
                <TweetCard key={card.id} card={card} last={i === g.items.length - 1} />
              ))}
            </Section>
          ))}

          {/* 页脚 */}
          <Section style={{ backgroundColor: color.footer, padding: "26px 36px 30px", borderTop: `1px solid ${color.line}`, textAlign: "center" }}>
            <Text style={{ fontSize: 13, margin: "0 0 10px" }}>
              <Link href={view.links.manage} style={{ color: color.link }}>管理订阅主题</Link>
              {"　"}
              <Link href={view.links.switchLang} style={{ color: color.link }}>{view.lang === "zh" ? "改为接收原文" : "改为接收中文"}</Link>
              {"　"}
              <Link href={view.links.rss} style={{ color: color.link }}>RSS 订阅</Link>
              {"　"}
              <Link href={view.links.unsubscribe} style={{ color: color.link }}>退订</Link>
            </Text>
            <Text style={{ fontSize: 12, lineHeight: "20px", color: color.muted, margin: 0 }}>
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
