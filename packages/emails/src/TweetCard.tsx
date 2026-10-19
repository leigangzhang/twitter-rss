/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
//
// 为了控制邮件体积（Gmail 超过约 102KB 会折叠末尾），卡片只用普通的 div / p 和最少的表格，
// 样式只写必要的属性；字体从外层继承，不在每个元素上重复。
import type { ArticleView, CardView } from "@xrss/core";
import type { CSSProperties, ReactNode } from "react";
import { CONTENT_WIDTH, color, font } from "./theme.ts";

const meta: CSSProperties = { fontFamily: font.mono, fontSize: 12, lineHeight: "18px", color: color.muted, margin: 0 };
const small: CSSProperties = { fontFamily: font.sans, fontSize: 11, lineHeight: "17px", color: color.muted, margin: "6px 0 0" };
// 长链接、长英文单词在窄屏上换行，不撑破卡片
const wrap: CSSProperties = { wordBreak: "break-word", overflowWrap: "anywhere" };
const bodyText: CSSProperties = { fontSize: 15, lineHeight: "26px", color: color.body, margin: 0, whiteSpace: "pre-line", ...wrap };
const noteText: CSSProperties = { fontSize: 14, lineHeight: "23px", color: color.body, margin: 0, ...wrap };
const link: CSSProperties = { color: color.link, textDecoration: "none" };

/** 一行两端对齐（左边内容 + 右边内容），用最简单的单行表格，所有邮箱都能正确排版 */
function Spread({ left, right, leftWidth, style }: { left: ReactNode; right?: ReactNode; leftWidth?: number; style?: CSSProperties }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={style}>
      <tbody>
        <tr>
          {left}
          {right ? (
            <td align="right" style={{ verticalAlign: "middle", whiteSpace: "nowrap" }}>
              {right}
            </td>
          ) : null}
        </tr>
      </tbody>
    </table>
  );
}

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
    return <img src={card.author.avatarUrl} width={40} height={40} alt="" style={{ borderRadius: 20, display: "block" }} />;
  }
  const [bg, fg] = tone(card.author.handle);
  return (
    <div style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: bg, color: fg, fontWeight: 700, fontSize: 15, lineHeight: "40px", textAlign: "center" }}>
      {card.author.initials}
    </div>
  );
}

function Parts({ card }: { card: CardView }) {
  if (card.parts.length === 1) {
    if (!card.parts[0]) return null;
    return (
      <>
        <p style={bodyText}>
          {card.parts[0]}
          {card.truncated ? "……" : ""}
        </p>
        {card.truncated ? (
          <p style={small}>
            全文较长，
            <a href={card.url} style={link}>
              在 X（原 Twitter）上阅读全文
            </a>
          </p>
        ) : null}
      </>
    );
  }
  const total = card.parts.length + card.moreParts;
  return (
    <>
      {card.parts.map((p, i) => (
        <p key={i} style={{ ...bodyText, margin: i === 0 ? 0 : "12px 0 0" }}>
          <span style={{ fontFamily: font.mono, fontSize: 12, color: color.faint }}>
            {i + 1}/{total}
          </span>{" "}
          {p}
        </p>
      ))}
      {card.moreParts > 0 ? (
        <p style={small}>
          另有 {card.moreParts} 条，
          <a href={card.url} style={link}>
            在 X（原 Twitter）上查看
          </a>
        </p>
      ) : null}
    </>
  );
}

/** 图片一张一行、铺满宽度（截图里的文字才看得清），点开是大图 */
function Images({ card }: { card: CardView }) {
  if (card.images.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      {card.images.map((img, i) => (
        <a key={i} href={img.href} style={{ display: "block", marginTop: i === 0 ? 0 : 10 }}>
          <img
            src={img.url}
            alt={img.alt ?? ""}
            width={CONTENT_WIDTH}
            height={img.width && img.height ? Math.round((CONTENT_WIDTH * img.height) / img.width) : undefined}
            style={{ width: "100%", maxWidth: CONTENT_WIDTH, height: "auto", borderRadius: 10, border: `1px solid ${color.line}`, display: "block" }}
          />
        </a>
      ))}
      {card.images.length > 1 ? <p style={small}>共 {card.images.length} 张，点图片看大图</p> : null}
    </div>
  );
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ backgroundColor: color.note, borderRadius: 8, padding: "12px 14px", marginTop: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: color.muted, margin: "0 0 4px" }}>{label}</p>
      <p style={noteText}>{text}</p>
    </div>
  );
}

function Video({ card }: { card: CardView }) {
  if (!card.video) return null;
  const note = card.mediaNote ?? "视频内容请在 X（原 Twitter）上观看。";
  if (!card.video.thumbUrl) return card.mediaNote ? <NoteBlock label="视频说明（AI 生成）" text={card.mediaNote} /> : null;
  return (
    <Spread
      style={{ marginTop: 14 }}
      left={
        <>
          <td width={146} style={{ verticalAlign: "top" }}>
            <a href={card.url}>
              <img src={card.video.thumbUrl} alt="视频封面" width={132} height={80} style={{ objectFit: "cover", borderRadius: 8, display: "block" }} />
            </a>
          </td>
          <td style={{ verticalAlign: "top" }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: color.muted, margin: "0 0 4px" }}>视频说明（AI 生成）</p>
            <p style={noteText}>{note}</p>
          </td>
        </>
      }
    />
  );
}

function Points({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((p, i) => (
        // 悬挂缩进：圆点在左，折行后的文字和第一行对齐
        <p key={i} style={{ ...noteText, margin: "2px 0 0", paddingLeft: 14, textIndent: -14 }}>
          · {p}
        </p>
      ))}
    </>
  );
}

/**
 * 外部文章：小字标出来源和标题（可点开），下面是 AI 概要和要点。
 * 不用带封面的大卡片，避免抢推文本身的注意力，也让邮件更小。
 */
function ArticleCard({ article }: { article: ArticleView }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${color.line}` }}>
      <p style={{ fontSize: 12, lineHeight: "19px", color: color.muted, margin: 0, ...wrap }}>
        {article.site ? `${article.site} · ` : ""}
        <a href={article.url} style={link}>
          {article.title} ↗
        </a>
        {article.originalTitle ? <span style={{ color: color.faint }}>{`（${article.originalTitle}）`}</span> : null}
      </p>
      {article.summary ? <p style={{ ...noteText, marginTop: 6 }}>{article.summary}</p> : null}
      <Points items={article.points} />
      {article.aiSummary ? <p style={{ ...small, marginTop: 4 }}>文章概要由 AI 生成</p> : null}
    </div>
  );
}

function Quoted({ card }: { card: CardView }) {
  const q = card.quoted;
  if (!q) return null;
  return (
    <div style={{ border: `1px solid ${color.line}`, borderRadius: 10, padding: "14px 16px", marginTop: 14, backgroundColor: "#FBFBFC" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: color.ink, margin: "0 0 6px" }}>
        {q.name}{" "}
        <a href={q.url} style={{ ...meta, fontWeight: 400, textDecoration: "none" }}>
          @{q.handle} · 引用
        </a>
      </p>
      {q.summary ? (
        <>
          <p style={noteText}>{q.summary}</p>
          <Points items={q.points} />
          <p style={small}>
            引用内容摘要由 AI 生成 ·{" "}
            <a href={q.url} style={link}>
              查看引用原文
            </a>
          </p>
        </>
      ) : q.text ? (
        <>
          <p style={{ ...noteText, lineHeight: "24px", whiteSpace: "pre-line" }}>
            {q.text}
            {q.truncated ? "……" : ""}
          </p>
          {q.truncated ? (
            <p style={small}>
              引用内容较长，
              <a href={q.url} style={link}>
                查看完整引用
              </a>
            </p>
          ) : null}
        </>
      ) : null}
      {q.article ? <ArticleCard article={q.article} /> : null}
    </div>
  );
}

/** 没有 AI 概要的普通链接：一行小字，不占卡片 */
function LinkPreview({ card }: { card: CardView }) {
  const l = card.link;
  if (!l) return null;
  if (!l.title && !l.description && l.kind !== "x_article") return null;
  const title = l.title ?? (l.kind === "x_article" ? "在 X（原 Twitter）上阅读这篇长文" : l.url);
  return (
    <p style={{ fontSize: 12, lineHeight: "19px", color: color.muted, margin: "12px 0 0", ...wrap }}>
      {l.domain ? `${l.domain} · ` : ""}
      <a href={l.url} style={link}>
        {title} ↗
      </a>
    </p>
  );
}

const chip: CSSProperties = { fontSize: 11, borderRadius: 4, padding: "3px 8px", whiteSpace: "nowrap" };

export function TweetCard({ card, last }: { card: CardView; last?: boolean }) {
  // 各段之间用不换行空格连接：窄屏上整段换行，不会把"昨天 12:00"拆成两行
  const metaLine = [`@${card.author.handle}`, card.time, card.translatedFrom]
    .filter(Boolean)
    .map((part) => part!.replace(/ /g, "\u00a0"))
    .join("\u00a0· ");
  return (
    <div className="xc" style={{ padding: "22px 36px 26px", borderBottom: last ? undefined : `1px solid ${color.lineSoft}` }}>
      {/* 头像 + 名字和时间。类型标签跟在名字后面，不单独占一列，手机上也不会挤压时间 */}
      <Spread
        style={{ marginBottom: 14 }}
        left={
          <>
            <td width={52} style={{ verticalAlign: "middle" }}>
              <Avatar card={card} />
            </td>
            <td style={{ verticalAlign: "middle" }}>
              <p style={{ fontSize: 15, fontWeight: 700, lineHeight: "22px", color: color.ink, margin: 0 }}>
                {card.author.name}
                {card.categoryLabel ? <span style={{ ...chip, fontWeight: 700, color: color.link, backgroundColor: "#EEF3FC", marginLeft: 8, verticalAlign: "1px" }}>{card.categoryLabel}</span> : null}
                {card.badge ? (
                  <span style={{ ...chip, fontWeight: 400, fontFamily: font.mono, color: color.muted, backgroundColor: color.chip, marginLeft: 6, verticalAlign: "1px" }}>{card.badge}</span>
                ) : null}
              </p>
              <p style={meta}>{metaLine}</p>
            </td>
          </>
        }
      />

      <Parts card={card} />
      <Images card={card} />
      {card.kind === "image" && card.mediaNote ? <NoteBlock label="图片说明（AI 生成）" text={card.mediaNote} /> : null}
      <Video card={card} />
      <Quoted card={card} />
      {card.article ? <ArticleCard article={card.article} /> : <LinkPreview card={card} />}

      <Spread
        style={{ marginTop: 14 }}
        left={
          <td style={meta}>
            ♡ {card.likes}&nbsp;&nbsp;&nbsp;&nbsp;⇄ {card.reposts}
          </td>
        }
        right={
          <a href={card.url} style={{ fontSize: 12, color: color.link, textDecoration: "none" }}>
            {card.ctaLabel}
          </a>
        }
      />
    </div>
  );
}

/** 超出邮件大小预算的条目：一行作者 + AI 一句话摘要，点开看原推 */
export function CompactItem({ card }: { card: CardView }) {
  return (
    <p style={{ fontSize: 14, lineHeight: "23px", color: color.body, margin: "0 0 10px", ...wrap }}>
      <span style={{ fontWeight: 700, color: color.ink }}>{card.author.name}</span>
      <span style={{ ...meta, fontSize: 11 }}> @{card.author.handle}</span>
      {"　"}
      {card.summary ?? card.parts[0]?.slice(0, 80)}{" "}
      <a href={card.url} style={{ ...link, fontSize: 12 }}>
        {card.ctaLabel}
      </a>
    </p>
  );
}
