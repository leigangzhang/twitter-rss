/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import { Body, Button, Container, Head, Html, Preview, Section, Text } from "@react-email/components";
import { color, font } from "./theme.ts";

export interface ConfirmEmailProps {
  confirmUrl: string;
  topicNames: string[];
  langLabel: string;
}

export function ConfirmEmail({ confirmUrl, topicNames, langLabel }: ConfirmEmailProps) {
  return (
    <Html lang="zh-CN">
      <Head />
      <Preview>确认订阅精选晨报</Preview>
      <Body style={{ backgroundColor: color.ground, fontFamily: font.sans, margin: 0, padding: "20px 0" }}>
        <Container style={{ maxWidth: 520, backgroundColor: color.card, borderRadius: 14, padding: "36px" }}>
          <Text style={{ fontSize: 24, fontWeight: 900, color: color.ink, margin: "0 0 12px" }}>确认你的订阅</Text>
          <Text style={{ fontSize: 15, lineHeight: "26px", color: color.body, margin: "0 0 8px" }}>
            你订阅了：{topicNames.join("、")}
          </Text>
          <Text style={{ fontSize: 15, lineHeight: "26px", color: color.body, margin: "0 0 24px" }}>阅读语言：{langLabel}</Text>
          <Section>
            <Button
              href={confirmUrl}
              style={{ backgroundColor: color.ink, color: "#FFFFFF", fontSize: 15, fontWeight: 700, borderRadius: 10, padding: "14px 28px" }}
            >
              确认订阅
            </Button>
          </Section>
          <Text style={{ fontSize: 12, lineHeight: "20px", color: color.muted, margin: "24px 0 0" }}>
            如果不是你本人操作，忽略这封邮件即可，不会收到任何后续邮件。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
