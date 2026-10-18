/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
import { Column, Img, Link, Row, Section, Text } from "@react-email/components";
import type { CardView } from "@xrss/core";
import { CONTENT_WIDTH, color, font } from "./theme.ts";

const meta = { fontFamily: font.mono, fontSize: 12, color: color.muted, margin: 0, lineHeight: "18px" } as const;
const bodyText = { fontSize: 15, lineHeight: "26px", color: color.body, margin: 0 } as const;

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
      全文较长，<Link href={card.url} style={{ color: color.link }}>在 X 上阅读全文</Link>
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
          另有 {card.moreParts} 条，<Link href={card.url} style={{ color: color.link }}>在 X 上查看</Link>
        </Text>
      ) : null}
    </>
  );
}

function Images({ card }: { card: CardView }) {
  if (card.images.length === 0) return null;
  if (card.images.length === 1) {
    const img = card.images[0]!;
    const height = img.width && img.height ? Math.round((CONTENT_WIDTH * img.height) / img.width) : undefined;
    return (
      <Img
        src={img.url}
        alt={img.alt ?? ""}
        width={CONTENT_WIDTH}
        height={height}
        style={{ width: "100%", maxWidth: CONTENT_WIDTH, height: "auto", borderRadius: 10, border: `1px solid ${color.line}`, marginTop: 14 }}
      />
    );
  }
  const half = (CONTENT_WIDTH - 8) / 2;
  const rows = [card.images.slice(0, 2), card.images.slice(2, 4)].filter((r) => r.length > 0);
  return (
    <Section style={{ marginTop: 14 }}>
      {rows.map((row, r) => (
        <Row key={r} style={{ marginBottom: 8 }}>
          {row.map((img, i) => (
            <Column key={i} style={{ width: half, paddingLeft: i === 1 ? 8 : 0, verticalAlign: "top" }}>
              <Img src={img.url} alt={img.alt ?? ""} width={half} height={half} style={{ objectFit: "cover", borderRadius: 8, display: "block" }} />
            </Column>
          ))}
        </Row>
      ))}
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
  const note = card.mediaNote ?? "视频内容请在 X 上观看。";
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

function Quoted({ card }: { card: CardView }) {
  if (!card.quoted) return null;
  return (
    <Section style={{ border: `1px solid ${color.line}`, borderRadius: 10, padding: "14px 16px", marginTop: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: 700, color: color.ink, margin: "0 0 6px" }}>
        {card.quoted.name} <span style={{ ...meta, fontWeight: 400 }}>@{card.quoted.handle} · 引用</span>
      </Text>
      <Text style={{ fontSize: 14, lineHeight: "24px", color: color.body, margin: 0, whiteSpace: "pre-line" }}>{card.quoted.text}</Text>
    </Section>
  );
}

function LinkPreview({ card }: { card: CardView }) {
  const link = card.link;
  if (!link) return null;
  // X 长文没抓到标题时也给一个可点击的卡片，而不是在正文里露出一串链接
  if (!link.title && !link.description && link.kind !== "x_article") return null;
  return (
    <Link href={link.url} style={{ display: "block", textDecoration: "none", marginTop: 14 }}>
      <Section style={{ border: `1px solid ${color.line}`, borderRadius: 10 }}>
        <Row>
          {link.imageUrl ? (
            <Column style={{ width: 120, verticalAlign: "top" }}>
              <Img src={link.imageUrl} alt="" width={120} height={96} style={{ objectFit: "cover", borderRadius: "10px 0 0 10px", display: "block" }} />
            </Column>
          ) : null}
          <Column style={{ padding: "12px 14px", verticalAlign: "middle" }}>
            <Text style={{ fontSize: 14, fontWeight: 700, lineHeight: "21px", color: color.ink, margin: "0 0 4px" }}>
              {link.title ?? (link.kind === "x_article" ? "在 X 上阅读这篇长文" : link.url)}
            </Text>
            {link.description ? <Text style={{ fontSize: 13, lineHeight: "20px", color: color.muted, margin: "0 0 4px" }}>{link.description}</Text> : null}
            {link.domain ? <Text style={{ ...meta, fontSize: 11 }}>{link.domain}</Text> : null}
          </Column>
        </Row>
      </Section>
    </Link>
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
        {card.badge ? (
          <Column align="right" style={{ verticalAlign: "middle", width: 110 }}>
            <span style={{ fontFamily: font.mono, fontSize: 11, color: color.muted, backgroundColor: color.chip, borderRadius: 4, padding: "3px 8px", whiteSpace: "nowrap" }}>
              {card.badge}
            </span>
          </Column>
        ) : null}
      </Row>

      <Parts card={card} />
      <Images card={card} />
      {card.kind === "image" && card.mediaNote ? <NoteBlock label="图片说明（AI 生成）" text={card.mediaNote} /> : null}
      <Video card={card} />
      <Quoted card={card} />
      <LinkPreview card={card} />

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
