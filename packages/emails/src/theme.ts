/**
 * 邮件的颜色、字体和尺寸。为阅读而设计：白底单栏、16px 正文、适合中文的 1.75 倍行距，
 * 不给每条内容套边框，让正文在任何设备上都占满可用宽度。
 * 邮件客户端不保证加载网页字体，使用系统字体栈（苹方优先）。
 */
export const color = {
  ground: "#FFFFFF",
  card: "#FFFFFF",
  ink: "#16191D",
  body: "#2A2F36",
  muted: "#6A717B",
  faint: "#9AA1AA",
  line: "#E8EAEE",
  lineSoft: "#F0F1F4",
  /** 引用左侧竖线 */
  rule: "#D5D9DF",
  /** AI 说明等辅助信息的底色 */
  note: "#F5F6F8",
  chip: "#F1F3F5",
  placeholder: "#E9ECF0",
  footer: "#F7F8FA",
  link: "#2F5BD3",
};

export const font = {
  sans: '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Segoe UI","Microsoft YaHei","Noto Sans SC",Roboto,Helvetica,Arial,sans-serif',
  mono: "Menlo,Consolas,monospace",
};

/** 邮件最大宽度：桌面端每行约 36 个汉字，长段落读起来不累 */
export const MAIL_WIDTH = 640;
/** 左右留白（桌面）；手机上由媒体查询改为 20px */
export const GUTTER = 32;
/** 正文宽度 */
export const CONTENT_WIDTH = MAIL_WIDTH - GUTTER * 2;
