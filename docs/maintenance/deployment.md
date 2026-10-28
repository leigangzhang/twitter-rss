# 上线部署

邮件里的确认、管理订阅、切换语言、退订和 RSS 链接都指向 `.env` 的 `SITE_URL`。没设置时是 `http://localhost:3000`，只有本机打得开。
有两种上线方式：让这台 Mac 常驻运行网站、用 Cloudflare Tunnel 对外访问（当前用法），或者部署到云端。

## 方式一：本机常驻 + Cloudflare Tunnel

数据库继续用本机的 `data/app.db`，流水线和网站在同一台 Mac 上。Mac 关机或断网时网站打不开。

1. **常驻运行网站**：编辑 [`agents/com.xrss.web.plist`](../../agents/com.xrss.web.plist) 里的项目路径，然后

   ```bash
   pnpm build
   cp agents/com.xrss.web.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.xrss.web.plist
   curl -I http://127.0.0.1:3000/         # 返回 200 即可
   ```

   它运行 `scripts/web.sh`（`next start`，只监听 `127.0.0.1:3000`，端口可用 `XRSS_WEB_PORT` 改；没有构建产物时先构建一次），
   开机自动启动、退出后自动拉起，日志在 `data/logs/web.log`。先停掉手动启动的 `pnpm dev`，否则 3000 端口被占用。
2. **Cloudflare Tunnel**：在 Cloudflare 控制台 Zero Trust → Networks → Tunnels 里选一个在这台 Mac 上运行的隧道（或新建一个），
   在 Public Hostname 里添加一个子域名，Service 选 `HTTP`、地址填 `127.0.0.1:3000`（不要写 `localhost`，网站只监听 IPv4）。
3. **改地址**：在 `.env` 里写上这个地址，重启网站：

   ```
   SITE_URL=https://你的子域名
   ```

   ```bash
   launchctl kickstart -k gui/$(id -u)/com.xrss.web
   ```

4. 在手机上打开 `https://你的子域名/` 确认订阅页正常；之后发出的邮件里的链接就会指向这个地址。之前已经发出的邮件里的链接仍是旧地址。

**代码更新后**：`pnpm build && launchctl kickstart -k gui/$(id -u)/com.xrss.web`。只改 `config/` 下的配置不用重启，网站会自动重新读取。

## 方式二：部署到云端

- **数据库**：把 `DATABASE_URL` 换成 Turso 地址（加 `DATABASE_AUTH_TOKEN`），本机流水线和线上网站共用。
- **网站**：`apps/web` 可部署到 Vercel 等平台；设置 `SITE_URL`、`SMTP_*`、`MAIL_FROM`、`ADMIN_PASSWORD`，并把 `config/` 目录一起部署（或设置 `CONFIG_DIR`）。
- 采集和流水线仍在本机运行（需要已登录 X 的 Chrome）。

## 管理后台

`/admin/...` 只在设置了 `ADMIN_PASSWORD` 时开放，上线后设置一个 16 位以上的随机密码。网站对外公开时建议再加两层 Cloudflare 的保护（都不用改代码）：

- **Cloudflare Access**：Zero Trust → Access → Applications 新建 Self-hosted 应用，路径填 `你的子域名/admin` 和 `你的子域名/api/admin`，策略只允许自己的邮箱（邮件一次性验证码登录）。陌生人连后台登录页都看不到，订阅页、RSS、退订不受影响。
- **限流规则**：Security → WAF → Rate limiting rules，给 `/api/subscribe`、`/api/manage-link`、`/api/admin/login` 设每个 IP 每分钟的上限。网站自己也有限流（见 [订阅页与管理后台](../features/web-admin.md)），但只在内存里，重启后清零。

网站给所有页面加了安全响应头（不允许被别的网站嵌入、HSTS 等，见 `apps/web/next.config.ts`）。

部署到 Vercel 等文件系统只读的平台时，在环境变量里设置 `ADMIN_SESSION_SECRET`（一串随机字符）代替 `data/admin-session.key`；这时"退出"只清掉本机的登录，要让所有登录失效就换这个值。

## 发信邮箱

默认 QQ 邮箱 SMTP（`smtp.qq.com:465`，`SMTP_PASS` 填授权码），逐封发送并间隔 1.5 秒。
QQ 邮箱对每日发信量和单封收件人数有限制，订阅者多了以后建议换企业邮箱或专业发信服务。
