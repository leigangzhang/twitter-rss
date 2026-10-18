/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import { Body, Button, Container, Head, Html, Link, Preview, Section, Text } from "@react-email/components";
import { color, font } from "./theme.ts";

export interface ManageLinkEmailProps {
  /** 本次请求要做的事 */
  action: "manage" | "unsubscribe" | "lang";
  /** 主按钮链接 */
  actionUrl: string;
  /** 管理订阅页（主题、语言、退订都在这里） */
  manageUrl: string;
  /** action 为 lang 时，要切换到的语言名 */
  langLabel?: string;
}

const TITLES = { manage: "管理你的订阅", unsubscribe: "确认退订", lang: "切换阅读语言" } as const;

export function ManageLinkEmail({ action, actionUrl, manageUrl, langLabel }: ManageLinkEmailProps) {
  const button = action === "unsubscribe" ? "退订精选晨报" : action === "lang" ? `改为接收${langLabel ?? ""}` : "打开订阅设置";
  return (
    <Html lang="zh-CN">
      <Head />
      <Preview>{TITLES[action]}</Preview>
      <Body style={{ backgroundColor: color.ground, fontFamily: font.sans, margin: 0, padding: "20px 0" }}>
        <Container style={{ maxWidth: 520, backgroundColor: color.card, borderRadius: 14, padding: "36px" }}>
          <Text style={{ fontSize: 24, fontWeight: 900, color: color.ink, margin: "0 0 12px" }}>{TITLES[action]}</Text>
          <Text style={{ fontSize: 15, lineHeight: "26px", color: color.body, margin: "0 0 24px" }}>
            有人（应该是你）在精选晨报网站上请求了这个链接。点击下面的按钮继续，链接只对你的邮箱有效。
          </Text>
          <Section>
            <Button
              href={actionUrl}
              style={{ backgroundColor: color.ink, color: "#FFFFFF", fontSize: 15, fontWeight: 700, borderRadius: 10, padding: "14px 28px" }}
            >
              {button}
            </Button>
          </Section>
          {action !== "manage" ? (
            <Text style={{ fontSize: 14, lineHeight: "24px", color: color.body, margin: "20px 0 0" }}>
              也可以 <Link href={manageUrl} style={{ color: color.link }}>打开订阅设置</Link> 调整主题和语言。
            </Text>
          ) : null}
          <Text style={{ fontSize: 12, lineHeight: "20px", color: color.muted, margin: "24px 0 0" }}>
            如果不是你本人操作，忽略这封邮件即可，你的订阅不会有任何变化。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
