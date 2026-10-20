/**
 * 颜色、字体和尺寸，尽量贴近 X（原 Twitter）网页版时间线：
 * 600px 宽的单栏、15px 正文、#0F1419 主文字、#536471 次要文字、#EFF3F4 分隔线、#1D9BF0 链接。
 * 邮件客户端不保证加载网页字体，使用和 X 相同的系统字体栈，再补上中文字体。
 */
export const color = {
  ground: "#F7F9F9",
  card: "#FFFFFF",
  ink: "#0F1419",
  body: "#0F1419",
  muted: "#536471",
  faint: "#8B98A5",
  line: "#EFF3F4",
  lineSoft: "#EFF3F4",
  /** 引用框、图片描边、Thread 连接线 */
  frame: "#CFD9DE",
  note: "#F7F9F9",
  chip: "#EFF3F4",
  placeholder: "#E9ECF0",
  footer: "#F7F9F9",
  link: "#1D9BF0",
  linkSoft: "#E8F5FD",
};

export const font = {
  sans: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif',
  mono: "Menlo,Consolas,monospace",
};

/** 邮件宽度（与 X 时间线一致） */
export const MAIL_WIDTH = 600;
/** 卡片左右留白 */
export const GUTTER = 16;
/** 头像栏：40px 头像 + 12px 间距 */
export const AVATAR_COL = 52;
/** 正文栏宽度：600 - 左右留白 - 头像栏 */
export const CONTENT_WIDTH = MAIL_WIDTH - GUTTER * 2 - AVATAR_COL;
