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
  /** 引用推文框的底色 */
  quoteBg: "#FBFBFC",
  chip: "#F1F3F5",
  placeholder: "#E9ECF0",
  footer: "#F7F8FA",
  link: "#2F5BD3",
  /** 内容类型标签（趋势解读、新发布等）：蓝色粗体 + 浅蓝底 */
  tag: "#1D8CE0",
  tagBg: "#E8F4FD",
};

export const font = {
  sans: '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Segoe UI","Microsoft YaHei","Noto Sans SC",Roboto,Helvetica,Arial,sans-serif',
  mono: "Menlo,Consolas,monospace",
};

/** 邮件最大宽度：桌面端每行约 36 个汉字，长段落读起来不累 */
export const MAIL_WIDTH = 640;
/**
 * 窄屏断点：窗口窄于邮件宽度时切换为手机版（左右留白 32→20px，标题小一号）。
 * 不再加宽桌面版：中文每行超过约 40 字，长段落换行时容易读串行。
 */
export const MOBILE_BREAKPOINT = MAIL_WIDTH;
/** 左右留白（桌面）；手机上由媒体查询改为 20px */
export const GUTTER = 32;
/** 正文宽度 */
export const CONTENT_WIDTH = MAIL_WIDTH - GUTTER * 2;
