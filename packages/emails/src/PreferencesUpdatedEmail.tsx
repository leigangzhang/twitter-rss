/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import { Body, Button, Container, Head, Html, Link, Preview, Section, Text } from "@react-email/components";
import { color, font } from "./theme.ts";

export interface PreferencesUpdatedEmailProps {
  topicNames: string[];
  langLabel: string;
  /** 修改前的设置，方便发现不是本人操作时改回去 */
  previous: { topicNames: string[]; langLabel: string };
  manageUrl: string;
  unsubscribeUrl: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text style={{ fontSize: 14, lineHeight: "24px", color: color.body, margin: "0 0 6px" }}>
      <span style={{ color: color.muted }}>{label}：</span>
      {value}
    </Text>
  );
}

/** 已订阅的邮箱在订阅页重新提交后，通知该邮箱设置已直接更新 */
export function PreferencesUpdatedEmail({ topicNames, langLabel, previous, manageUrl, unsubscribeUrl }: PreferencesUpdatedEmailProps) {
  return (
    <Html lang="zh-CN">
      <Head />
      <Preview>{`订阅设置已更新：${topicNames.join("、")}`}</Preview>
      <Body style={{ backgroundColor: color.ground, fontFamily: font.sans, margin: 0, padding: "20px 0" }}>
        <Container style={{ maxWidth: 520, backgroundColor: color.card, borderRadius: 14, padding: "36px" }}>
          <Text style={{ fontSize: 24, fontWeight: 900, color: color.ink, margin: "0 0 12px" }}>订阅设置已更新</Text>
          <Text style={{ fontSize: 15, lineHeight: "26px", color: color.body, margin: "0 0 20px" }}>
            你在精选晨报订阅页重新提交了订阅，新的设置从下一封邮件开始生效：
          </Text>
          <Section style={{ backgroundColor: color.ground, borderRadius: 10, padding: "16px 18px", margin: "0 0 20px" }}>
            <Row label="主题" value={topicNames.join("、")} />
            <Row label="语言" value={langLabel} />
          </Section>
          <Text style={{ fontSize: 13, lineHeight: "22px", color: color.muted, margin: "0 0 24px" }}>
            之前的设置：{previous.topicNames.join("、") || "无"} · {previous.langLabel}
          </Text>
          <Section>
            <Button
              href={manageUrl}
              style={{ backgroundColor: color.ink, color: "#FFFFFF", fontSize: 15, fontWeight: 700, borderRadius: 10, padding: "14px 28px" }}
            >
              查看或修改设置
            </Button>
          </Section>
          <Text style={{ fontSize: 12, lineHeight: "20px", color: color.muted, margin: "24px 0 0" }}>
            如果不是你本人操作，点上面的按钮改回去即可；不想再收到邮件可以<Link href={unsubscribeUrl} style={{ color: color.link }}>退订</Link>。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
