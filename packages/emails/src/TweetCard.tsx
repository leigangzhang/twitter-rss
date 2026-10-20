/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
//
// 版式贴近 X（原 Twitter）时间线：左边 40px 头像，正文缩进在头像右侧；名字、@账号、时间在一行；
// Thread 用头像下方的竖线串起来；图片和引用是 16px 圆角的描边框；底部是灰色的互动数据。
// 为了控制邮件体积（Gmail 超过约 102KB 会折叠末尾），样式只写必要的属性，字体从外层继承。
import type { ArticleView, CardView } from "@xrss/core";
import type { CSSProperties, ReactNode } from "react";
import { AVATAR_COL, CONTENT_WIDTH, color } from "./theme.ts";

// 长链接、长英文单词在窄屏上换行，不撑破卡片
const wrap: CSSProperties = { wordBreak: "break-word", overflowWrap: "anywhere" };
const bodyText: CSSProperties = { fontSize: 15, lineHeight: "22px", color: color.body, margin: 0, whiteSpace: "pre-line", ...wrap };
const subText: CSSProperties = { fontSize: 15, lineHeight: "22px", color: color.body, margin: 0, ...wrap };
const gray: CSSProperties = { fontSize: 13, lineHeight: "18px", color: color.muted, margin: "8px 0 0", ...wrap };
const link: CSSProperties = { color: color.link, textDecoration: "none" };
const tableAttrs = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

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
  return <div style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: bg, color: fg, fontWeight: 700, fontSize: 15, lineHeight: "40px", textAlign: "center" }}>{card.author.initials}</div>;
}

/** 名字 · 标签 · @账号 · 时间，和 X 一样排在一行（窄屏上自然折行） */
function Header({ card }: { card: CardView }) {
  const tail = [`@${card.author.handle}`, card.time].map((s) => s.replace(/ /g, " ")).join(" · ");
  return (
    <p style={{ fontSize: 15, lineHeight: "20px", color: color.muted, margin: "0 0 2px", ...wrap }}>
      <b style={{ color: color.ink }}>{card.author.name}</b>
      {card.categoryLabel ? <span style={{ fontSize: 12, fontWeight: 700, color: color.link, backgroundColor: color.linkSoft, borderRadius: 4, padding: "1px 6px", marginLeft: 6, whiteSpace: "nowrap" }}>{card.categoryLabel}</span> : null}{" "}
      {tail}
      {card.badge ? ` · ${card.badge.replace(/ /g, " ")}` : ""}
    </p>
  );
}

function FirstPart({ card }: { card: CardView }) {
  const text = card.parts[0];
  if (!text) return null;
  const single = card.parts.length === 1;
  return (
    <>
      <p style={bodyText}>
        {text}
        {single && card.truncated ? "……" : ""}
      </p>
      {single && card.truncated ? (
        <p style={gray}>
          全文较长，
          <a href={card.url} style={link}>
            在 X（原 Twitter）上阅读全文
          </a>
        </p>
      ) : null}
    </>
  );
}

/** 图片一张一行、铺满正文栏（截图里的文字才看得清），点开是大图 */
function Images({ card }: { card: CardView }) {
  if (card.images.length === 0) return null;
  return (
    <>
      {card.images.map((img, i) => (
        <a key={i} href={img.href} style={{ display: "block", marginTop: 12 }}>
          <img
            src={img.url}
            alt={img.alt ?? ""}
            width={CONTENT_WIDTH}
            height={img.width && img.height ? Math.round((CONTENT_WIDTH * img.height) / img.width) : undefined}
            style={{ width: "100%", maxWidth: CONTENT_WIDTH, height: "auto", borderRadius: 16, border: `1px solid ${color.frame}`, display: "block" }}
          />
        </a>
      ))}
    </>
  );
}

/** AI 生成的说明：仿 X 的"读者补充背景信息"框 */
function NoteBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${color.frame}`, borderRadius: 16, padding: "10px 12px", marginTop: 12 }}>
      <p style={{ fontSize: 13, lineHeight: "18px", fontWeight: 700, color: color.ink, margin: "0 0 4px" }}>{label}</p>
      {children}
    </div>
  );
}

function Video({ card }: { card: CardView }) {
  if (!card.video) return null;
  const note = card.mediaNote ?? "视频内容请在 X（原 Twitter）上观看。";
  return (
    <>
      {card.video.thumbUrl ? (
        <a href={card.url} style={{ display: "block", marginTop: 12 }}>
          <img src={card.video.thumbUrl} alt="视频封面" width={CONTENT_WIDTH} style={{ width: "100%", maxWidth: CONTENT_WIDTH, height: "auto", borderRadius: 16, border: `1px solid ${color.frame}`, display: "block" }} />
        </a>
      ) : null}
      {card.mediaNote || card.video.thumbUrl ? (
        <NoteBlock label="▶ 视频说明（AI 生成）">
          <p style={subText}>{note}</p>
        </NoteBlock>
      ) : null}
    </>
  );
}

function Points({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((p, i) => (
        // 悬挂缩进：圆点在左，折行后的文字和第一行对齐
        <p key={i} style={{ ...subText, margin: "4px 0 0", paddingLeft: 10, textIndent: -10 }}>
          · {p}
        </p>
      ))}
    </>
  );
}

/** 外部文章：一行小字标出来源和标题（可点开），下面是 AI 概要和要点，不用抢眼的大卡片 */
function ArticleCard({ article }: { article: ArticleView }) {
  return (
    <NoteBlock label="文章概要（AI 生成）">
      <p style={{ fontSize: 13, lineHeight: "18px", color: color.muted, margin: "0 0 6px", ...wrap }}>
        {article.site ? `${article.site} · ` : ""}
        <a href={article.url} style={link}>
          {article.title} ↗
        </a>
        {article.originalTitle ? `（${article.originalTitle}）` : ""}
      </p>
      {article.summary ? <p style={subText}>{article.summary}</p> : null}
      <Points items={article.points} />
    </NoteBlock>
  );
}

/** 引用推文：和 X 一样的 16px 圆角描边框，内部字号与正文一致 */
function Quoted({ card }: { card: CardView }) {
  const q = card.quoted;
  if (!q) return null;
  return (
    <div style={{ border: `1px solid ${color.frame}`, borderRadius: 16, padding: 12, marginTop: 12 }}>
      <p style={{ fontSize: 15, lineHeight: "20px", color: color.muted, margin: "0 0 4px", ...wrap }}>
        <b style={{ color: color.ink }}>{q.name}</b>{" "}
        <a href={q.url} style={{ color: color.muted, textDecoration: "none" }}>
          @{q.handle}
        </a>
      </p>
      {q.summary ? (
        <>
          <p style={subText}>{q.summary}</p>
          <Points items={q.points} />
          <p style={gray}>
            引用内容较长，以上为 AI 摘要 ·{" "}
            <a href={q.url} style={link}>
              查看原文
            </a>
          </p>
        </>
      ) : q.text ? (
        <>
          <p style={bodyText}>
            {q.text}
            {q.truncated ? "……" : ""}
          </p>
          {q.truncated ? (
            <p style={gray}>
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

/** 没有 AI 概要的普通链接：一行小字 */
function LinkPreview({ card }: { card: CardView }) {
  const l = card.link;
  if (!l) return null;
  if (!l.title && !l.description && l.kind !== "x_article") return null;
  const title = l.title ?? (l.kind === "x_article" ? "在 X（原 Twitter）上阅读这篇长文" : l.url);
  return (
    <p style={{ ...gray, marginTop: 12 }}>
      {l.domain ? `${l.domain} · ` : ""}
      <a href={l.url} style={link}>
        {title} ↗
      </a>
    </p>
  );
}

/** 第一条之后的内容：媒体、引用、链接、翻译说明、互动数据 */
function Rest({ card }: { card: CardView }) {
  return (
    <>
      {card.moreParts > 0 ? (
        <p style={gray}>
          这个 Thread 另有 {card.moreParts} 条，
          <a href={card.url} style={link}>
            在 X（原 Twitter）上查看
          </a>
        </p>
      ) : null}
      <Images card={card} />
      {card.kind === "image" && card.mediaNote ? (
        <NoteBlock label="图片说明（AI 生成）">
          <p style={subText}>{card.mediaNote}</p>
        </NoteBlock>
      ) : null}
      <Video card={card} />
      <Quoted card={card} />
      {card.article ? <ArticleCard article={card.article} /> : <LinkPreview card={card} />}
      {card.translatedFrom ? <p style={gray}>由 AI {card.translatedFrom}</p> : null}
      <table {...tableAttrs} width="100%" style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <td style={{ fontSize: 13, lineHeight: "18px", color: color.muted }}>
              ♡&nbsp;{card.likes}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;⇄&nbsp;{card.reposts}
            </td>
            <td align="right" style={{ fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap" }}>
              <a href={card.url} style={link}>
                {card.ctaLabel}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/** Thread 连接线：头像栏里居中的一根 2px 竖线（表格单元格会自动撑满整行高度，所有邮箱都能显示） */
function LineCells() {
  return (
    <>
      <td />
      <td {...({ bgcolor: color.frame } as object)} style={{ backgroundColor: color.frame }} />
      <td />
    </>
  );
}

/** 固定头像栏三列的宽度（19 + 2 + 31 = 52），不让正文的长短影响对齐 */
function SizingRow() {
  const cell = (w: number) => <td width={w} style={{ width: w, minWidth: w, height: 0, lineHeight: 0, fontSize: 0 }} />;
  return (
    <tr>
      {cell(19)}
      {cell(2)}
      {cell(AVATAR_COL - 21)}
      <td style={{ height: 0, lineHeight: 0, fontSize: 0 }} />
    </tr>
  );
}

export function TweetCard({ card, last }: { card: CardView; last?: boolean }) {
  const thread = card.parts.slice(1);
  const top: CSSProperties = { verticalAlign: "top" };
  return (
    <div style={{ padding: "12px 16px", borderBottom: last ? undefined : `1px solid ${color.line}` }}>
      <table {...tableAttrs} width="100%">
        <tbody>
          {thread.length ? <SizingRow /> : null}
          <tr>
            <td colSpan={thread.length ? 3 : 1} width={AVATAR_COL} style={{ ...top, width: AVATAR_COL, minWidth: AVATAR_COL }}>
              <Avatar card={card} />
            </td>
            <td rowSpan={thread.length ? 2 : 1} style={top}>
              <Header card={card} />
              <FirstPart card={card} />
              {thread.length ? null : <Rest card={card} />}
            </td>
          </tr>
          {thread.length ? (
            <>
              <tr>
                <LineCells />
              </tr>
              {thread.map((p, i) => (
                <tr key={i}>
                  <LineCells />
                  <td style={{ ...top, paddingTop: 12 }}>
                    <p style={bodyText}>{p}</p>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} />
                <td style={top}>
                  <Rest card={card} />
                </td>
              </tr>
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** 超出邮件大小预算的条目：一行作者 + AI 一句话摘要，点开看原推 */
export function CompactItem({ card }: { card: CardView }) {
  return (
    <p style={{ fontSize: 15, lineHeight: "22px", color: color.body, margin: "0 0 10px", ...wrap }}>
      <b>{card.author.name}</b>
      <span style={{ color: color.muted }}> @{card.author.handle}</span>
      {" · "}
      {card.summary ?? card.parts[0]?.slice(0, 80)}{" "}
      <a href={card.url} style={{ ...link, fontSize: 13 }}>
        {card.ctaLabel}
      </a>
    </p>
  );
}
