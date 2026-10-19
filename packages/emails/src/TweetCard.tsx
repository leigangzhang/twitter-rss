/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import { Column, Img, Link, Row, Section, Text } from "@react-email/components";
import type { ArticleView, CardView } from "@xrss/core";
import { CONTENT_WIDTH, color, font } from "./theme.ts";

const meta = { fontFamily: font.mono, fontSize: 12, color: color.muted, margin: 0, lineHeight: "18px" } as const;
// 长链接、长英文单词在窄屏上换行，不撑破卡片
const bodyText = { fontSize: 15, lineHeight: "26px", color: color.body, margin: 0, wordBreak: "break-word", overflowWrap: "anywhere" } as const;

/** 没有头像时按账号名固定挑一组底色 */
const AVATAR_TONES: Array<[string, string]> = [
  ["#DCE6F9", "#1F5FD6"],
  ["#E4E1F5", "#4B3FA8"],
  ["#DCEFE4", "#2F7D4F"],
  ["#F7E6D6", "#B85A0A"],
  ["#F2E3E8", "#A3365A"],
];

function tone(handle: string): [string, string] {
  let h = 0;
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

function Avatar({ card }: { card: CardView }) {
  if (card.author.avatarUrl) {
    return <Img src={card.author.avatarUrl} width={40} height={40} alt="" style={{ borderRadius: 20, display: "block" }} />;
  }
  const [bg, fg] = tone(card.author.handle);
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: bg,
        color: fg,
        fontWeight: 700,
        fontSize: 15,
        lineHeight: "40px",
        textAlign: "center",
      }}
    >
      {card.author.initials}
    </div>
  );
}

function TruncatedHint({ card }: { card: CardView }) {
  if (!card.truncated) return null;
  return (
    <Text style={{ ...meta, marginTop: 8 }}>
      全文较长，<Link href={card.url} style={{ color: color.link }}>在 X（原 Twitter）上阅读全文</Link>
    </Text>
  );
}

function Parts({ card }: { card: CardView }) {
  if (card.parts.length === 1) {
    if (!card.parts[0]) return null;
    return (
      <>
        <Text style={{ ...bodyText, whiteSpace: "pre-line" }}>
          {card.parts[0]}
          {card.truncated ? "…" : ""}
        </Text>
        <TruncatedHint card={card} />
      </>
    );
  }
  const total = card.parts.length + card.moreParts;
  return (
    <>
      {card.parts.map((p, i) => (
        <Row key={i} style={{ marginBottom: 12 }}>
          <Column style={{ width: 36, verticalAlign: "top", ...meta, color: color.faint, paddingTop: 4 }}>
            {i + 1}/{total}
          </Column>
          <Column style={{ verticalAlign: "top" }}>
            <Text style={{ ...bodyText, whiteSpace: "pre-line" }}>{p}</Text>
          </Column>
        </Row>
      ))}
      {card.moreParts > 0 ? (
        <Text style={{ ...meta, paddingLeft: 36 }}>
          另有 {card.moreParts} 条，<Link href={card.url} style={{ color: color.link }}>在 X（原 Twitter）上查看</Link>
        </Text>
      ) : null}
    </>
  );
}

/**
 * 图片：一张一行、铺满宽度（截图里的文字才看得清），点开是大图。
 * 多图不再拼成 2×2 小格。
 */
function Images({ card }: { card: CardView }) {
  if (card.images.length === 0) return null;
  return (
    <Section style={{ marginTop: 14 }}>
      {card.images.map((img, i) => {
        const height = img.width && img.height ? Math.round((CONTENT_WIDTH * img.height) / img.width) : undefined;
        return (
          <Link key={i} href={img.href} style={{ display: "block", marginTop: i === 0 ? 0 : 10 }}>
            <Img
              src={img.url}
              alt={img.alt ?? ""}
              width={CONTENT_WIDTH}
              height={height}
              style={{ width: "100%", maxWidth: CONTENT_WIDTH, height: "auto", borderRadius: 10, border: `1px solid ${color.line}`, display: "block" }}
            />
          </Link>
        );
      })}
      {card.images.length > 1 ? <Text style={{ ...meta, fontSize: 11, marginTop: 6 }}>共 {card.images.length} 张，点图片看大图</Text> : null}
    </Section>
  );
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <Section style={{ backgroundColor: color.note, borderRadius: 8, padding: "12px 14px", marginTop: 14 }}>
      <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: color.muted, margin: "0 0 4px" }}>{label}</Text>
      <Text style={{ fontSize: 14, lineHeight: "24px", color: color.body, margin: 0 }}>{text}</Text>
    </Section>
  );
}

function Video({ card }: { card: CardView }) {
  if (!card.video) return null;
  if (!card.video.thumbUrl) return card.mediaNote ? <NoteBlock label="视频说明（AI 生成）" text={card.mediaNote} /> : null;
  const note = card.mediaNote ?? "视频内容请在 X（原 Twitter）上观看。";
  return (
    <Row style={{ marginTop: 14 }}>
      <Column style={{ width: 146, verticalAlign: "top" }}>
        <Link href={card.url}>
          <Img src={card.video.thumbUrl} alt="视频封面" width={132} height={80} style={{ objectFit: "cover", borderRadius: 8, display: "block" }} />
        </Link>
      </Column>
      <Column style={{ verticalAlign: "top" }}>
        <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: color.muted, margin: "0 0 4px" }}>视频说明（AI 生成）</Text>
        <Text style={{ fontSize: 14, lineHeight: "24px", color: color.body, margin: 0 }}>{note}</Text>
      </Column>
    </Row>
  );
}

/**
 * 外部文章：小字标出来源和标题（可点开），下面是 AI 概要和要点。
 * 不再用带封面的大卡片，避免抢推文本身的注意力，也让邮件更小。
 */
function ArticleCard({ article }: { article: ArticleView }) {
  return (
    <Section style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${color.line}` }}>
      <Text style={{ fontSize: 12, lineHeight: "19px", color: color.muted, margin: 0 }}>
        {article.site ? `${article.site} · ` : ""}
        <Link href={article.url} style={{ color: color.link }}>
          {article.title} ↗
        </Link>
        {article.originalTitle ? <span style={{ color: color.faint }}>{`（${article.originalTitle}）`}</span> : null}
      </Text>
      {article.summary ? <Text style={{ fontSize: 14, lineHeight: "23px", color: color.body, margin: "6px 0 0" }}>{article.summary}</Text> : null}
      <Points items={article.points} />
      {article.aiSummary ? <Text style={{ ...meta, fontSize: 11, marginTop: 4 }}>文章概要由 AI 生成</Text> : null}
    </Section>
  );
}

function Points({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <Section style={{ marginTop: 4 }}>
      {items.map((p, i) => (
        <Row key={i}>
          <Column style={{ width: 14, verticalAlign: "top", fontSize: 14, lineHeight: "23px", color: color.muted }}>·</Column>
          <Column style={{ verticalAlign: "top" }}>
            <Text style={{ fontSize: 14, lineHeight: "23px", color: color.body, margin: 0 }}>{p}</Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}

function Quoted({ card }: { card: CardView }) {
  const q = card.quoted;
  if (!q) return null;
  return (
    <Section style={{ border: `1px solid ${color.line}`, borderRadius: 10, padding: "14px 16px", marginTop: 14, backgroundColor: "#FBFBFC" }}>
      <Text style={{ fontSize: 13, fontWeight: 700, color: color.ink, margin: "0 0 6px" }}>
        {q.name}{" "}
        <Link href={q.url} style={{ ...meta, fontWeight: 400, textDecoration: "none" }}>
          @{q.handle} · 引用
        </Link>
      </Text>
      {q.summary ? (
        <>
          <Text style={{ fontSize: 14, lineHeight: "24px", color: color.body, margin: 0, wordBreak: "break-word" }}>{q.summary}</Text>
          <Points items={q.points} />
          <Text style={{ ...meta, fontSize: 11, marginTop: 6 }}>
            引用内容摘要由 AI 生成 ·{" "}
            <Link href={q.url} style={{ color: color.link }}>
              查看引用原文
            </Link>
          </Text>
        </>
      ) : q.text ? (
        <>
          <Text style={{ fontSize: 14, lineHeight: "24px", color: color.body, margin: 0, whiteSpace: "pre-line", wordBreak: "break-word", overflowWrap: "anywhere" }}>
            {q.text}
            {q.truncated ? "……" : ""}
          </Text>
          {q.truncated ? (
            <Text style={{ ...meta, fontSize: 11, marginTop: 6 }}>
              引用内容较长，
              <Link href={q.url} style={{ color: color.link }}>
                查看完整引用
              </Link>
            </Text>
          ) : null}
        </>
      ) : null}
      {q.article ? <ArticleCard article={q.article} /> : null}
    </Section>
  );
}

/** 没有 AI 概要的普通链接：一行小字，不占卡片 */
function LinkPreview({ card }: { card: CardView }) {
  const link = card.link;
  if (!link) return null;
  if (!link.title && !link.description && link.kind !== "x_article") return null;
  const title = link.title ?? (link.kind === "x_article" ? "在 X（原 Twitter）上阅读这篇长文" : link.url);
  return (
    <Text style={{ fontSize: 12, lineHeight: "19px", color: color.muted, margin: "12px 0 0", wordBreak: "break-word" }}>
      {link.domain ? `${link.domain} · ` : ""}
      <Link href={link.url} style={{ color: color.link }}>
        {title} ↗
      </Link>
    </Text>
  );
}

export function TweetCard({ card, last }: { card: CardView; last?: boolean }) {
  const metaLine = [`@${card.author.handle}`, card.time, card.translatedFrom].filter(Boolean).join(" · ");
  return (
    <Section style={{ padding: "22px 36px 26px", borderBottom: last ? undefined : `1px solid ${color.lineSoft}` }}>
      <Row style={{ marginBottom: 14 }}>
        <Column style={{ width: 52, verticalAlign: "middle" }}>
          <Avatar card={card} />
        </Column>
        <Column style={{ verticalAlign: "middle" }}>
          <Text style={{ fontSize: 15, fontWeight: 700, color: color.ink, margin: 0, lineHeight: "22px" }}>{card.author.name}</Text>
          <Text style={meta}>{metaLine}</Text>
        </Column>
        {card.badge || card.categoryLabel ? (
          <Column align="right" style={{ verticalAlign: "middle", width: 170 }}>
            {card.categoryLabel ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: color.link, backgroundColor: "#EEF3FC", borderRadius: 4, padding: "3px 8px", whiteSpace: "nowrap" }}>
                {card.categoryLabel}
              </span>
            ) : null}
            {card.badge ? (
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  color: color.muted,
                  backgroundColor: color.chip,
                  borderRadius: 4,
                  padding: "3px 8px",
                  whiteSpace: "nowrap",
                  marginLeft: card.categoryLabel ? 6 : 0,
                }}
              >
                {card.badge}
              </span>
            ) : null}
          </Column>
        ) : null}
      </Row>

      <Parts card={card} />
      <Images card={card} />
      {card.kind === "image" && card.mediaNote ? <NoteBlock label="图片说明（AI 生成）" text={card.mediaNote} /> : null}
      <Video card={card} />
      <Quoted card={card} />
      {card.article ? <ArticleCard article={card.article} /> : <LinkPreview card={card} />}

      <Row style={{ marginTop: 14 }}>
        <Column>
          <Text style={meta}>
            ♡ {card.likes}&nbsp;&nbsp;&nbsp;&nbsp;⇄ {card.reposts}
          </Text>
        </Column>
        <Column align="right">
          <Link href={card.url} style={{ fontSize: 12, color: color.link }}>
            {card.ctaLabel}
          </Link>
        </Column>
      </Row>
    </Section>
  );
}
