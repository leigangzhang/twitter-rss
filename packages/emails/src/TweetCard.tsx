/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
//
// 为阅读设计的条目版式：
// - 长推文先给一行 AI 摘要做标题，方便扫读；短推文直接看正文
// - 头像放在作者行里，正文占满整栏宽度（不在左侧留头像栏），手机上也不显窄
// - 不给条目、引用套边框：引用用左侧竖线，AI 说明用浅灰底，层级靠字号和颜色区分
// 为了控制邮件体积（Gmail 超过约 102KB 会折叠末尾），样式只写必要的属性，字体从外层继承。
import type { ArticleView, CardView } from "@xrss/core";
import type { CSSProperties, ReactNode } from "react";
import { CONTENT_WIDTH, color } from "./theme.ts";

// 长链接、长英文单词在窄屏上换行，不撑破版面
const wrap: CSSProperties = {
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};
const bodyText: CSSProperties = {
  fontSize: 16,
  lineHeight: "28px",
  color: color.body,
  margin: 0,
  whiteSpace: "pre-line",
  ...wrap,
};
const noteText: CSSProperties = {
  fontSize: 15,
  lineHeight: "25px",
  color: color.body,
  margin: 0,
  ...wrap,
};
const small: CSSProperties = {
  fontSize: 13,
  lineHeight: "20px",
  color: color.muted,
  margin: "8px 0 0",
  ...wrap,
};
const link: CSSProperties = { color: color.link, textDecoration: "none" };
// 摘要只比正文稍重一点：同样字号，中等字重、颜色更深
const summaryText: CSSProperties = {
  fontSize: 16,
  lineHeight: "28px",
  fontWeight: 500,
  color: color.ink,
  margin: 0,
  ...wrap,
};
const aiTag: CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: color.muted,
  marginRight: 8,
  verticalAlign: "1px",
};

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
    return (
      <img
        src={card.author.avatarUrl}
        width={32}
        height={32}
        alt=""
        style={{ borderRadius: 16, display: "block" }}
      />
    );
  }
  const [bg, fg] = tone(card.author.handle);
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: bg,
        color: fg,
        fontWeight: 700,
        fontSize: 12,
        lineHeight: "32px",
        textAlign: "center",
      }}
    >
      {card.author.initials}
    </div>
  );
}

/** 超过这个字数的推文：作者行下先给 AI 摘要，原文默认折叠 */
export const SUMMARY_MIN_CHARS = 300;

function summaryOf(card: CardView): string | undefined {
  if (!card.summary) return undefined;
  const length = card.parts.reduce((n, p) => n + p.length, 0);
  return length > SUMMARY_MIN_CHARS ? card.summary : undefined;
}

/** 作者行：小头像 + 名字，第二行是 @账号、时间和内容类型 */
function Byline({ card }: { card: CardView }) {
  const meta = [`@${card.author.handle}`, card.time, card.badge]
    .filter(Boolean)
    .map((s) => s!.replace(/ /g, " "));
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
    >
      <tbody>
        <tr>
          <td width={42} style={{ width: 42, verticalAlign: "middle" }}>
            <Avatar card={card} />
          </td>
          <td style={{ verticalAlign: "middle", ...wrap }}>
            <p
              style={{
                fontSize: 14,
                lineHeight: "18px",
                fontWeight: 700,
                color: color.ink,
                margin: 0,
              }}
            >
              {card.author.name}
              {card.categoryLabel ? (
                <span
                  style={{
                    fontSize: 12,
                    lineHeight: "18px",
                    fontWeight: 700,
                    color: color.tag,
                    backgroundColor: color.tagBg,
                    borderRadius: 4,
                    padding: "2px 6px",
                    marginLeft: 8,
                    whiteSpace: "nowrap",
                  }}
                >
                  {card.categoryLabel}
                </span>
              ) : null}
            </p>
            <p
              style={{
                fontSize: 13,
                lineHeight: "18px",
                color: color.muted,
                margin: 0,
              }}
            >
              {meta.join("　")}
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Body({ card }: { card: CardView }) {
  const [first, ...rest] = card.parts;
  return (
    <>
      {first ? (
        <p style={bodyText}>
          {first}
          {card.parts.length === 1 && card.truncated ? "……" : ""}
        </p>
      ) : null}
      {rest.map((p, i) => (
        <p key={i} style={{ ...bodyText, marginTop: 14 }}>
          {p}
        </p>
      ))}
      {card.parts.length === 1 && card.truncated ? (
        <p style={small}>
          全文较长，
          <a href={card.url} style={link}>
            在 X（原 Twitter）上阅读全文
          </a>
        </p>
      ) : null}
      {card.moreParts > 0 ? (
        <p style={small}>
          这组连续推文还有 {card.moreParts} 条，
          <a href={card.url} style={link}>
            在 X（原 Twitter）上查看
          </a>
        </p>
      ) : null}
    </>
  );
}

/** 图片一张一行、铺满正文宽度（截图里的文字才看得清），点开是大图 */
function Images({ card }: { card: CardView }) {
  return (
    <>
      {card.images.map((img, i) => (
        <a key={i} href={img.href} style={{ display: "block", marginTop: 14 }}>
          <img
            src={img.url}
            alt={img.alt ?? ""}
            width={CONTENT_WIDTH}
            height={
              img.width && img.height
                ? Math.round((CONTENT_WIDTH * img.height) / img.width)
                : undefined
            }
            style={{
              width: "100%",
              maxWidth: CONTENT_WIDTH,
              height: "auto",
              borderRadius: 8,
              display: "block",
            }}
          />
        </a>
      ))}
    </>
  );
}

/** AI 生成的辅助信息：浅灰底，和作者原文区分开 */
function Note({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="xn"
      style={{
        backgroundColor: color.note,
        borderRadius: 8,
        padding: "12px 16px",
        marginTop: 14,
      }}
    >
      <p
        style={{
          fontSize: 13,
          lineHeight: "20px",
          fontWeight: 700,
          color: color.muted,
          margin: "0 0 4px",
        }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function Video({ card }: { card: CardView }) {
  if (!card.video) return null;
  return (
    <>
      {card.video.thumbUrl ? (
        <a href={card.url} style={{ display: "block", marginTop: 14 }}>
          <img
            src={card.video.thumbUrl}
            alt="视频封面，点开在 X（原 Twitter）上观看"
            width={CONTENT_WIDTH}
            style={{
              width: "100%",
              maxWidth: CONTENT_WIDTH,
              height: "auto",
              borderRadius: 8,
              display: "block",
            }}
          />
        </a>
      ) : null}
      {card.mediaNote ? (
        <Note label="视频讲了什么（AI 生成）">
          <p style={noteText}>{card.mediaNote}</p>
        </Note>
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
        <p
          key={i}
          style={{
            ...noteText,
            margin: "4px 0 0",
            paddingLeft: 12,
            textIndent: -12,
          }}
        >
          • {p}
        </p>
      ))}
    </>
  );
}

/** 外部文章：来源和标题一行（可点开），下面是 AI 概要和要点 */
function Article({ article }: { article: ArticleView }) {
  return (
    <Note label="链接文章概要（AI 生成）">
      <p
        style={{
          fontSize: 14,
          lineHeight: "22px",
          fontWeight: 700,
          margin: "0 0 4px",
          ...wrap,
        }}
      >
        <a href={article.url} style={link}>
          {article.title}
        </a>
      </p>
      {article.site || article.originalTitle ? (
        <p
          style={{
            fontSize: 13,
            lineHeight: "20px",
            color: color.muted,
            margin: "0 0 6px",
            ...wrap,
          }}
        >
          {[article.site, article.originalTitle].filter(Boolean).join("　")}
        </p>
      ) : null}
      {article.summary ? <p style={noteText}>{article.summary}</p> : null}
      <Points items={article.points} />
    </Note>
  );
}

/** 引用推文：左侧竖线，不套框，内容不被压窄 */
function Quoted({ card }: { card: CardView }) {
  const q = card.quoted;
  if (!q) return null;
  return (
    <div
      style={{
        borderLeft: `3px solid ${color.rule}`,
        paddingLeft: 14,
        marginTop: 16,
      }}
    >
      <p
        style={{
          fontSize: 13,
          lineHeight: "20px",
          color: color.muted,
          margin: "0 0 4px",
          ...wrap,
        }}
      >
        引用 <b style={{ color: color.ink }}>{q.name}</b>{" "}
        <a href={q.url} style={{ color: color.muted, textDecoration: "none" }}>
          @{q.handle}
        </a>
      </p>
      {q.summary ? (
        <>
          <p style={noteText}>{q.summary}</p>
          <Points items={q.points} />
          <p style={small}>
            原文较长，以上是 AI 摘要。
            <a href={q.url} style={link}>
              查看原文
            </a>
          </p>
        </>
      ) : q.text ? (
        <>
          <p style={{ ...noteText, whiteSpace: "pre-line" }}>
            {q.text}
            {q.truncated ? "……" : ""}
          </p>
          {q.truncated ? (
            <p style={small}>
              <a href={q.url} style={link}>
                查看完整引用
              </a>
            </p>
          ) : null}
        </>
      ) : null}
      {q.article ? <Article article={q.article} /> : null}
    </div>
  );
}

/** 没有 AI 概要的普通链接：一行小字 */
function LinkLine({ card }: { card: CardView }) {
  const l = card.link;
  if (!l) return null;
  if (!l.title && !l.description && l.kind !== "x_article") return null;
  const title =
    l.title ??
    (l.kind === "x_article" ? "在 X（原 Twitter）上阅读这篇长文" : l.url);
  return (
    <p style={{ ...small, marginTop: 12 }}>
      链接：
      <a href={l.url} style={link}>
        {title}
      </a>
      {l.domain ? `（${l.domain}）` : ""}
    </p>
  );
}

export function TweetCard({ card, last }: { card: CardView; last?: boolean }) {
  const summary = summaryOf(card);
  const counts = `${card.likes} 赞　${card.reposts} 转发`;
  return (
    // 分隔线只画在正文宽度内，和主题标题下的色线对齐
    <div className="xc" style={{ padding: "0 32px" }}>
      <div
        style={{
          padding: "24px 0 22px",
          borderBottom: last ? undefined : `1px solid ${color.line}`,
        }}
      >
        <Byline card={card} />
        <div style={{ height: 12, lineHeight: "12px", fontSize: 0 }}>
          &nbsp;
        </div>
        {summary ? (
          <>
            <p style={summaryText}>
              <span style={aiTag}>AI 摘要</span>
              {summary}
            </p>
            {/*
              原文折叠：隐藏的复选框 + 标签。只在支持的邮箱（苹果邮件等）生效，见 DailyDigest 里的 foldCss；
              不支持的邮箱（Gmail、QQ 网页版）看不到"展开原文"，原文直接显示在摘要下面。
            */}
            <input
              type="checkbox"
              id={`xr-${card.id}`}
              className="xr-in"
              style={{ display: "none", msoHide: "all" } as CSSProperties}
            />
            <label
              htmlFor={`xr-${card.id}`}
              className="xr-l"
              style={
                {
                  display: "none",
                  maxHeight: 0,
                  overflow: "hidden",
                  fontSize: 14,
                  lineHeight: "22px",
                  color: color.link,
                  fontWeight: 700,
                  marginTop: 8,
                  cursor: "pointer",
                } as CSSProperties
              }
            >
              <span className="xr-o">展开原文 ▾</span>
              <span className="xr-c">收起原文 ▴</span>
            </label>
            <div className="xr-body" style={{ marginTop: 12 }}>
              <Body card={card} />
            </div>
          </>
        ) : (
          <Body card={card} />
        )}
        <Images card={card} />
        {card.kind === "image" && card.mediaNote ? (
          <Note label="图片里有什么（AI 生成）">
            <p style={noteText}>{card.mediaNote}</p>
          </Note>
        ) : null}
        <Video card={card} />
        <Quoted card={card} />
        {card.article ? (
          <Article article={card.article} />
        ) : (
          <LinkLine card={card} />
        )}
        <p style={{ ...small, marginTop: 14 }}>
          {card.translatedFrom
            ? `AI ${card.translatedFrom.replace(/^译自/, "翻译自")}　`
            : ""}
          {counts}
          {"　"}
          <a href={card.url} style={{ ...link, fontWeight: 700 }}>
            {card.video ? "在 X 上看视频" : "在 X 上查看"}
          </a>
        </p>
      </div>
    </div>
  );
}

/** 超出邮件大小预算的条目：一行作者 + AI 一句话摘要，点开看原推 */
export function CompactItem({ card }: { card: CardView }) {
  return (
    <p
      style={{
        fontSize: 15,
        lineHeight: "25px",
        color: color.body,
        margin: "0 0 12px",
        ...wrap,
      }}
    >
      <a
        href={card.url}
        style={{ color: color.ink, textDecoration: "none", fontWeight: 700 }}
      >
        {card.summary ?? card.parts[0]?.slice(0, 80)}
      </a>
      <br />
      <span style={{ fontSize: 13, color: color.muted }}>
        {card.author.name}　@{card.author.handle}
      </span>
    </p>
  );
}
