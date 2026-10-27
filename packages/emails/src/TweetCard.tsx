/** @jsxRuntime automatic @jsxImportSource react */
// 本包也会被其他包的 tsx 进程直接加载，这里显式指定 JSX 运行时
//
// 为阅读设计的条目版式：
// - 长推文先给一行 AI 摘要做标题，方便扫读；短推文直接看正文
// - 头像放在作者行里，正文占满整栏宽度（不在左侧留头像栏），手机上也不显窄
// - 不给条目、引用套边框：引用用左侧竖线，AI 说明用浅灰底，层级靠字号和颜色区分
// 为了控制邮件体积（Gmail 超过约 102KB 会折叠末尾），样式只写必要的属性，字体从外层继承。
import { type ArticleView, type CardView, READER_SUMMARY_MIN_CHARS } from "@xrss/core";
import type { CSSProperties, ReactNode } from "react";
import { CONTENT_WIDTH, color, font } from "./theme.ts";

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
// 摘要不加底色：结论和正文同字号、稍重一点（中等字重、深色），要点用常规字重，靠"AI 摘要"标签和层次区分
const summaryBox: CSSProperties = {};
const summaryLine: CSSProperties = {
  fontSize: 15,
  lineHeight: "25px",
  fontWeight: 400,
  margin: 0,
  ...wrap,
};
const summaryLead: CSSProperties = {
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


/** 优先用阅读摘要（结论 + 要点）；旧数据没有时退回一句话摘要 */
function summaryOf(
  card: CardView,
): { lead: string; points: string[] } | undefined {
  const s =
    card.readerSummary ??
    (card.summary ? { lead: card.summary, points: [] } : undefined);
  if (!s) return undefined;
  const length = card.parts.reduce((n, p) => n + p.length, 0);
  // 超过这个字数的推文：作者行下先给 AI 摘要，原文默认折叠（阈值和评审时生成摘要的一致）
  return length > READER_SUMMARY_MIN_CHARS ? s : undefined;
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

/**
 * 赞 / 踩：卡片底部最左边，和"翻译自""赞数"同样的灰色小字，其余内容依次右移。
 * 后台预览会用样式换成图标（见 pipeline 的 admin-preview.ts），所以分隔符单独包一层便于隐藏。
 */
function Feedback({ links }: { links: { up: string; down: string } }) {
  const style: CSSProperties = { color: color.muted, textDecoration: "none", whiteSpace: "nowrap" };
  return (
    <>
      <a href={links.up} style={style} data-vote="up">
        赞
      </a>
      <span data-vote-sep="">{" · "}</span>
      <a href={links.down} style={style} data-vote="down">
        踩
      </a>
      {"　"}
    </>
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
  if (card.images.length === 0) return null;
  const imgTag = (img: CardView["images"][number], style: CSSProperties) => (
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
        ...style,
      }}
    />
  );
  // 单张图：本来就铺满宽度、按原比例完整显示，不需要放大。
  // 苹果邮件等点了不跳转（见 mediaCss 的 .xi-a）；Gmail 等不支持的邮箱点开是大图文件
  if (card.images.length === 1) {
    const img = card.images[0]!;
    return (
      <a
        href={img.href}
        className="xi-a"
        style={{ display: "block", marginTop: 14 }}
      >
        {imgTag(img, {})}
      </a>
    );
  }
  const group = `xi-${card.id}`;
  return (
    // 多张图（支持 :checked 的邮箱，如苹果邮件）：左右滑动的横条；点某一张，横条原地换成这张图的全宽大图，再点收起。
    // 不弹出浮层：iPhone 邮件里浮层会定位到整封邮件的中间，而不是当前屏幕。
    // 不支持的邮箱（Gmail、QQ 网页版）：一张一行铺满宽度，点图打开大图文件。
    <div className="xg">
      <input
        type="radio"
        name={group}
        id={`${group}-n`}
        className="xi-in"
        defaultChecked
        style={{ display: "none", msoHide: "all" } as CSSProperties}
      />
      {card.images.map((_, i) => (
        <input
          key={i}
          type="radio"
          name={group}
          id={`${group}-${i}`}
          className={`xi-in xi-z xi-in-${i}`}
          style={{ display: "none", msoHide: "all" } as CSSProperties}
        />
      ))}
      <div className={`xgm xg-${card.id}`}>
        {card.images.map((img, i) => (
          <div key={i} className="xgi" style={{ marginTop: 14 }}>
            <label
              htmlFor={`${group}-${i}`}
              className="xi-l"
              style={{ display: "block" }}
            >
              <a href={img.href} className="xi-a" style={{ display: "block" }}>
                {imgTag(img, {})}
              </a>
            </label>
          </div>
        ))}
      </div>
      {/* 放大：默认隐藏，选中哪张显示哪张；点图片回到横条 */}
      <div className="xz">
        {card.images.map((img, i) => (
          <label
            key={i}
            htmlFor={`${group}-n`}
            className={`xz-${i}`}
            style={{ display: "none", marginTop: 14 }}
          >
            {imgTag(img, {})}
            <span
              style={{
                display: "block",
                fontSize: 12,
                lineHeight: "18px",
                color: color.muted,
                marginTop: 6,
              }}
            >
              第 {i + 1} / {card.images.length} 张，点图片收起
            </span>
          </label>
        ))}
      </div>
      <p
        className="xg-tip"
        style={{
          display: "none",
          fontSize: 12,
          lineHeight: "18px",
          color: color.muted,
          margin: "6px 0 0",
        }}
      >
        共 {card.images.length} 张，左右滑动查看，点图放大
      </p>
    </div>
  );
}

/** AI 生成的辅助信息：浅灰底，和作者原文区分开 */
function Note({
  label,
  children,
  flat,
}: {
  label: string;
  children: ReactNode;
  flat?: boolean;
}) {
  return (
    <div
      className={flat ? undefined : "xn"}
      style={
        // 放在引用框里时不再套灰底框，用虚线和引用内容分开
        flat
          ? {
              borderTop: `1px dashed ${color.line}`,
              paddingTop: 10,
              marginTop: 12,
            }
          : {
              backgroundColor: color.note,
              borderRadius: 8,
              padding: "12px 16px",
              marginTop: 14,
            }
      }
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

/**
 * 视频：显示封面，点开在 X 上播放（时长已在作者行，"在 X 上看视频"在底部）；不做 AI 说明。
 * 没有封面时（video_mode: summary）补一行提示。
 */
function Video({ card }: { card: CardView }) {
  if (!card.video) return null;
  if (!card.video.thumbUrl) {
    return (
      <p style={{ ...small, marginTop: 12 }}>
        ▶ 附视频{card.video.duration ? `（${card.video.duration}）` : ""}，请在
        X 上观看
      </p>
    );
  }
  // 只显示封面，点了不跳转；看视频用底部的"在 X 上看视频"
  return (
    <img
      src={card.video.thumbUrl}
      alt="视频封面"
      width={CONTENT_WIDTH}
      style={{
        width: "100%",
        maxWidth: CONTENT_WIDTH,
        height: "auto",
        borderRadius: 8,
        display: "block",
        marginTop: 14,
      }}
    />
  );
}

function Points({
  items,
  style = noteText,
}: {
  items?: string[];
  style?: CSSProperties;
}) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((p, i) => (
        // 悬挂缩进：圆点在左，折行后的文字和第一行对齐
        <p
          key={i}
          style={{
            ...style,
            margin: "4px 0 0",
            paddingLeft: 14,
            textIndent: -14,
          }}
        >
          · {p}
        </p>
      ))}
    </>
  );
}

/** 外部文章：来源和标题一行（可点开），下面是 AI 概要和要点 */
function Article({ article, flat }: { article: ArticleView; flat?: boolean }) {
  return (
    <Note label="链接文章概要（AI 生成）" flat={flat}>
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

/** 引用推文：浅灰底、细边框的圆角框，标题行是名字 + @账号 · 引用 */
const quoteText: CSSProperties = {
  fontSize: 14,
  lineHeight: "23px",
  color: color.body,
  margin: 0,
  ...wrap,
};

function Quoted({ card }: { card: CardView }) {
  const q = card.quoted;
  if (!q) return null;
  return (
    <div
      className="xn"
      style={{
        border: `1px solid ${color.line}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginTop: 14,
        backgroundColor: color.quoteBg,
      }}
    >
      <p
        style={{
          fontSize: 13,
          lineHeight: "20px",
          fontWeight: 700,
          color: color.ink,
          margin: "0 0 6px",
          ...wrap,
        }}
      >
        {q.name}{" "}
        <a
          href={q.url}
          style={{
            fontFamily: font.mono,
            fontSize: 12,
            fontWeight: 400,
            color: color.muted,
            textDecoration: "none",
          }}
        >
          @{q.handle} · 引用
        </a>
      </p>
      {q.summary ? (
        <>
          <p style={quoteText}>{q.summary}</p>
          <Points items={q.points} style={quoteText} />
          <p style={{ ...small, fontSize: 12 }}>
            引用内容摘要由 AI 生成 ·{" "}
            <a href={q.url} style={link}>
              查看引用原文
            </a>
          </p>
        </>
      ) : q.text ? (
        <>
          <p
            style={{ ...quoteText, lineHeight: "24px", whiteSpace: "pre-line" }}
          >
            {q.text}
            {q.truncated ? "……" : ""}
          </p>
          {q.truncated ? (
            <p style={{ ...small, fontSize: 12 }}>
              引用内容较长，
              <a href={q.url} style={link}>
                查看完整引用
              </a>
            </p>
          ) : null}
        </>
      ) : null}
      {q.article ? <Article article={q.article} flat /> : null}
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
  const toggle = (
    <label
      htmlFor={`xr-${card.id}`}
      className="xr-l"
      style={
        {
          display: "none",
          fontSize: 14,
          fontWeight: 400,
          color: color.link,
          whiteSpace: "nowrap",
          cursor: "pointer",
        } as CSSProperties
      }
    >
      <span className="xr-o">展开原文 ▾</span>
      <span className="xr-c">收起原文 ▴</span>
    </label>
  );
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
            {/*
              原文折叠：隐藏的复选框 + 摘要末尾的"展开原文"。只在支持的邮箱（苹果邮件等）生效，见 DailyDigest 里的 foldCss；
              不支持的邮箱（Gmail、QQ 网页版）看不到"展开原文"，原文直接显示在摘要下面。
              复选框放在摘要段落前面，CSS 才能用 ~ 选中后面的段落和原文。
            */}
            <input
              type="checkbox"
              id={`xr-${card.id}`}
              className="xr-in"
              style={{ display: "none", msoHide: "all" } as CSSProperties}
            />
            {/* 摘要：结论一句（稍重），要点悬挂缩进；"展开原文"单独一行（不支持折叠的邮箱里这一行是空的） */}
            <div className="xr-s" style={summaryBox}>
              <p style={summaryLead}>
                <span style={aiTag}>AI 摘要</span>
                {summary.lead}
              </p>
              {summary.points.map((p, i) => (
                <p
                  key={i}
                  style={{
                    ...summaryLine,
                    color: color.body,
                    marginTop: 4,
                    paddingLeft: 14,
                    textIndent: -14,
                  }}
                >
                  · {p}
                </p>
              ))}
              <p
                style={{ fontSize: 14, lineHeight: "22px", margin: "6px 0 0" }}
              >
                {toggle}
              </p>
            </div>
            <div className="xr-body" style={{ marginTop: 16 }}>
              <Body card={card} />
              {/* 读到原文末尾时就地收起，不用翻回摘要；只在支持折叠的邮箱里显示 */}
              <label
                htmlFor={`xr-${card.id}`}
                className="xr-l2"
                style={
                  {
                    display: "none",
                    fontSize: 14,
                    lineHeight: "22px",
                    fontWeight: 400,
                    color: color.link,
                    marginTop: 8,
                    cursor: "pointer",
                  } as CSSProperties
                }
              >
                收起原文 ▴
              </label>
            </div>
          </>
        ) : (
          <Body card={card} />
        )}
        <Images card={card} />
        <Video card={card} />
        <Quoted card={card} />
        {card.article ? (
          <Article article={card.article} />
        ) : (
          <LinkLine card={card} />
        )}
        <p style={{ ...small, marginTop: 14 }}>
          {card.feedback ? <Feedback links={card.feedback} /> : null}
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
