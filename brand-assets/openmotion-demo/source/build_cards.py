from pathlib import Path
import base64

ROOT = Path(__file__).resolve().parent
FONT_DIR = ROOT / "fonts"
IMG_DIR = ROOT / "article-assets"
OUT = ROOT / "cards-project" / "index.html"


def b64(path):
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


F400 = b64(FONT_DIR / "NotoSansSC-400.woff2")
F700 = b64(FONT_DIR / "NotoSansSC-700.woff2")
F900 = b64(FONT_DIR / "NotoSansSC-900.woff2")
M400 = b64(FONT_DIR / "JetBrainsMono-400.woff2")
M700 = b64(FONT_DIR / "JetBrainsMono-700.woff2")
EMAIL_IMG = b64(IMG_DIR / "card-email.jpg")
SUBSCRIBE_IMG = b64(IMG_DIR / "card-subscribe.jpg")

HTML = r'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>精选晨报 · 三张竖版宣传卡</title>
<style>
@font-face{font-family:'Noto Sans SC';src:url(data:font/woff2;base64,@@F400@@) format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'Noto Sans SC';src:url(data:font/woff2;base64,@@F700@@) format('woff2');font-weight:700;font-style:normal;font-display:block}
@font-face{font-family:'Noto Sans SC Black';src:url(data:font/woff2;base64,@@F900@@) format('woff2');font-weight:900;font-style:normal;font-display:block}
@font-face{font-family:'JetBrains Mono';src:url(data:font/woff2;base64,@@M400@@) format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'JetBrains Mono';src:url(data:font/woff2;base64,@@M700@@) format('woff2');font-weight:700;font-style:normal;font-display:block}
:root{--ground:#F7F8FA;--ink:#15171A;--body:#2B2F36;--muted:#5F6670;--faint:#8A929D;--line:#DEE3E8;--blue:#1F5FD6;--strong:#16479F;--soft:#F3F7FE;--amber:#B45309;--orange:#C2410C;--rose:#BE123C;--sky:#0369A1}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#E7EBF0}
body{width:1080px;margin:0 auto;font-family:'Noto Sans SC',sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.board{width:1080px;display:flex;flex-direction:column}
.card{position:relative;width:1080px;height:1440px;overflow:hidden;background:var(--ground)}
.card::before{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(21,23,26,.028) 1px,transparent 1px),linear-gradient(180deg,rgba(21,23,26,.028) 1px,transparent 1px);background-size:72px 72px}
.card::after{content:'';position:absolute;top:-140px;right:-130px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(31,95,214,.10),transparent 68%);pointer-events:none}
.card>*{position:relative;z-index:1}
.card-01::after{top:auto;bottom:290px;right:-200px;width:680px;height:680px;background:radial-gradient(circle,rgba(31,95,214,.075),transparent 68%)}
.card-03::after{top:-160px;left:-180px;right:auto;width:620px;height:620px;background:radial-gradient(circle,rgba(190,18,60,.055),transparent 68%)}
.topbar{position:absolute;left:72px;right:72px;top:64px;display:flex;align-items:center;justify-content:space-between;gap:20px}
.brand-lockup{display:flex;align-items:center;gap:14px}
.brand-mark{width:54px;height:54px;border-radius:14px;background:var(--ink);color:#fff;display:grid;place-items:center;font-family:'Noto Sans SC Black',sans-serif;font-size:32px;font-weight:900;line-height:1}
.brand-name{font-size:30px;font-weight:900;letter-spacing:.02em}
.meta{font:400 14px/1.2 'JetBrains Mono',monospace;color:var(--faint);letter-spacing:.1em;text-align:right}
.kicker{position:absolute;left:72px;top:180px;font:400 17px/1.3 'JetBrains Mono',monospace;color:var(--blue);letter-spacing:.14em}
h1{margin:0;font-family:'Noto Sans SC Black',sans-serif;font-weight:900;letter-spacing:-.045em}
.lede{margin:0;font-size:29px;line-height:1.5;color:var(--muted);letter-spacing:.005em}
.lede strong{color:var(--ink);font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chip{display:inline-flex;align-items:center;min-height:40px;padding:0 15px;border-radius:99px;background:#fff;border:1px solid var(--line);font-size:16px;font-weight:700;color:var(--body)}
.chip.blue{border-color:#C9D8F4;background:var(--soft);color:var(--strong)}
.footer{position:absolute;left:72px;right:72px;bottom:54px;display:flex;align-items:flex-end;justify-content:space-between;gap:20px}
.footer .url{font:400 15px/1.3 'JetBrains Mono',monospace;color:var(--body)}
.footer .num{font:400 14px/1.3 'JetBrains Mono',monospace;color:var(--faint);letter-spacing:.1em}
.rule{position:absolute;left:72px;right:72px;bottom:103px;height:1px;background:var(--line)}

/* card 01 */
.card-01 h1{position:absolute;left:72px;top:224px;width:936px;font-size:80px;line-height:1.16}
.card-01 .lede{position:absolute;left:72px;top:537px;width:850px}
.card-01 .chips{position:absolute;left:72px;top:624px;width:850px}
.card-01 .visual{position:absolute;left:72px;top:713px;width:936px;height:536px;border-radius:23px;overflow:hidden;background:#fff;border:1px solid var(--line);box-shadow:0 28px 64px rgba(21,23,26,.10)}
.card-01 .visual img{width:100%;height:100%;object-fit:cover;object-position:50% 44%;display:block}
.card-01 .visual .badge{position:absolute;left:22px;top:22px;padding:9px 12px;border-radius:7px;background:rgba(255,255,255,.93);font:700 13px/1 'JetBrains Mono',monospace;letter-spacing:.04em}
.card-01 .visual .fade{position:absolute;inset:0;background:linear-gradient(180deg,transparent 62%,rgba(21,23,26,.10))}

/* card 02 */
.card-02 h1{position:absolute;left:72px;top:225px;width:936px;font-size:82px;line-height:1.15}
.card-02 .funnel{position:absolute;left:50%;top:465px;width:900px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:13px}
.card-02 .layer{position:relative;display:flex;align-items:center;height:82px;border-radius:12px;border:1.5px solid var(--line);background:#fff;padding:0 24px;box-shadow:0 8px 24px rgba(21,23,26,.045)}
.card-02 .layer .idx{width:38px;flex:0 0 38px;font:400 13px/1 'JetBrains Mono',monospace;color:var(--faint)}
.card-02 .layer .label{font-size:23px;font-weight:700;white-space:nowrap}
.card-02 .layer .note{margin-left:auto;font-size:16px;color:var(--muted);white-space:nowrap}
.card-02 .layer:nth-child(1){width:880px}
.card-02 .layer:nth-child(2){width:818px}
.card-02 .layer:nth-child(3){width:756px;border-color:var(--blue);background:var(--blue);color:#fff}
.card-02 .layer:nth-child(3) .idx,.card-02 .layer:nth-child(3) .note{color:rgba(255,255,255,.76)}
.card-02 .layer:nth-child(4){width:694px}
.card-02 .layer:nth-child(5){width:632px;border:2px dashed var(--blue);background:var(--soft);color:var(--strong)}
.card-02 .layer:nth-child(5) .idx{color:#6C8DC6}.card-02 .layer:nth-child(5) .note{color:#466BAB}
.card-02 .feedback{margin-top:19px;display:flex;align-items:center;gap:12px;padding:16px 20px;border:1.5px dashed var(--blue);border-radius:11px;background:rgba(243,247,254,.78);color:var(--strong);font-size:18px;font-weight:700}
.card-02 .feedback .arrow{font:700 26px/1 'JetBrains Mono',monospace;color:var(--blue)}
.card-02 .quote{position:absolute;left:72px;top:1090px;font-size:37px;line-height:1.3;font-weight:700;letter-spacing:-.03em}
.card-02 .quote em{font-style:normal;color:var(--blue)}
.card-02 .source{position:absolute;left:72px;top:1168px;font:400 14px/1.3 'JetBrains Mono',monospace;color:var(--faint);letter-spacing:.06em}

/* card 03 */
.card-03 h1{position:absolute;left:72px;top:224px;width:936px;font-size:92px;line-height:1.12}
.card-03 .lede{position:absolute;left:72px;top:445px;width:850px}
.card-03 .stats{position:absolute;left:72px;top:540px;width:936px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.card-03 .stat{min-height:158px;padding:20px 20px 18px;border-radius:15px;background:#fff;border:1px solid var(--line);box-shadow:0 8px 24px rgba(21,23,26,.04)}
.card-03 .stat .big{font-family:'Noto Sans SC Black',sans-serif;font-size:60px;line-height:.92;font-weight:900;letter-spacing:-.06em}
.card-03 .stat:nth-child(1) .big{color:var(--blue)}
.card-03 .stat:nth-child(2) .big{color:var(--amber)}
.card-03 .stat:nth-child(3) .big{color:var(--rose)}
.card-03 .stat .label{margin-top:12px;font-size:17px;color:var(--muted)}
.card-03 .panels{position:absolute;left:72px;top:734px;width:936px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card-03 .panel{height:300px;border-radius:17px;background:#fff;border:1px solid var(--line);overflow:hidden;box-shadow:0 12px 32px rgba(21,23,26,.055)}
.card-03 .panel .panel-head{height:56px;display:flex;align-items:center;gap:10px;padding:0 18px;border-bottom:1px solid var(--line);font:700 15px/1 'JetBrains Mono',monospace;color:var(--body)}
.card-03 .panel .panel-head .dot{width:8px;height:8px;border-radius:2px;background:var(--blue)}
.card-03 .email-panel img{width:100%;height:244px;object-fit:cover;object-position:50% 35%;display:block}
.card-03 .rss-panel{padding:0;background:var(--blue);border-color:var(--blue);color:#fff}
.card-03 .rss-panel .panel-head{color:rgba(255,255,255,.8);border-bottom-color:rgba(255,255,255,.22)}
.card-03 .rss-panel .panel-head .dot{background:#fff}
.card-03 .rss-big{height:244px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:15px}
.card-03 .rss-big svg{width:88px;height:88px}
.card-03 .rss-big .rss-copy{font:700 16px/1.4 'JetBrains Mono',monospace;color:rgba(255,255,255,.9);text-align:center}
.card-03 .rss-big .rss-copy small{display:block;margin-top:4px;font:400 14px/1.3 'Noto Sans SC',sans-serif;color:rgba(255,255,255,.68)}
.card-03 .cta{position:absolute;left:72px;top:1088px;width:936px;height:88px;border-radius:13px;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 25px;text-decoration:none}
.card-03 .cta .url{font:400 19px/1.2 'JetBrains Mono',monospace;letter-spacing:-.02em}
.card-03 .cta .go{font:700 28px/1 'JetBrains Mono',monospace;color:#8FB2F4}
.card-03 .note{position:absolute;left:72px;top:1200px;width:936px;font-size:13px;line-height:1.45;color:var(--faint)}
</style>
</head>
<body>
<div class="board">
  <section class="card card-01" id="card-01">
    <div class="topbar"><div class="brand-lockup"><span class="brand-mark">X</span><span class="brand-name">精选晨报</span></div><div class="meta">AI DIGEST / 01<br>twitter-rss</div></div>
    <div class="kicker">X / AI / EVERY MORNING</div>
    <h1>每天一封邮件，<br>读完 AI 圈一线建设者<br>昨天说了什么</h1>
    <p class="lede">从几百条 X 推文，到 <strong>30–60 条精选</strong>。</p>
    <div class="chips"><span class="chip blue">AI 精选</span><span class="chip">中文 / 原文</span><span class="chip">邮件 + RSS</span></div>
    <div class="visual"><img src="data:image/jpeg;base64,@@EMAIL@@"><span class="badge">真实邮件卡片</span><span class="fade"></span></div>
    <div class="rule"></div>
    <div class="footer"><span class="url">X（原 Twitter）· 每天早上一封</span><span class="num">01 / 03</span></div>
  </section>

  <section class="card card-02" id="card-02">
    <div class="topbar"><div class="brand-lockup"><span class="brand-mark">X</span><span class="brand-name">精选晨报</span></div><div class="meta">SYSTEM / 02<br>twitter-rss</div></div>
    <div class="kicker">NOT A CRAWLER / A CURATION SYSTEM</div>
    <h1>不是爬虫，<br>是一套精选系统</h1>
    <div class="funnel">
      <div class="layer"><span class="idx">01</span><span class="label">采集</span><span class="note">只读 · 按额度慢采</span></div>
      <div class="layer"><span class="idx">02</span><span class="label">规则粗筛</span><span class="note">去回复 / 纯转发 / 过短</span></div>
      <div class="layer"><span class="idx">03</span><span class="label">AI 初审 · 3/5 分以上</span><span class="note">6 类内容 · 同次翻译与摘要</span></div>
      <div class="layer"><span class="idx">04</span><span class="label">编辑终审</span><span class="note">同事件 / 同观点去重</span></div>
      <div class="layer"><span class="idx">05</span><span class="label">人工反馈</span><span class="note">赞 / 踩 → 修正 curation.md</span></div>
      <div class="feedback"><span class="arrow">↺</span><span>后台反馈会回到精选标准：标准显式化，下一期更合口味。</span></div>
    </div>
    <div class="quote">把“什么值得读”<em>写成标准。</em></div>
    <div class="source">CURATION.MD · 6 CONTENT TYPES · 5-POINT SCORE</div>
    <div class="rule"></div>
    <div class="footer"><span class="url">采集 → 精选 → 反馈闭环</span><span class="num">02 / 03</span></div>
  </section>

  <section class="card card-03" id="card-03">
    <div class="topbar"><div class="brand-lockup"><span class="brand-mark">X</span><span class="brand-name">精选晨报</span></div><div class="meta">DISTRIBUTION / 03<br>twitter-rss</div></div>
    <div class="kicker">ONE SOURCE / MULTI-CHANNEL</div>
    <h1>一处采集，<br>多处分发</h1>
    <p class="lede">同一份精选，<strong>邮件和 RSS 都能读。</strong></p>
    <div class="stats">
      <div class="stat"><div class="big">30–60</div><div class="label">条 / 天，按评分排序</div></div>
      <div class="stat"><div class="big">5</div><div class="label">个主题，中文 / 原文自选</div></div>
      <div class="stat"><div class="big">&lt;1</div><div class="label">元 / 天，按文章口径*</div></div>
    </div>
    <div class="panels">
      <div class="panel email-panel"><div class="panel-head"><span class="dot"></span>EMAIL / 每天早上一封</div><img src="data:image/jpeg;base64,@@SUBSCRIBE@@" alt="精选晨报订阅页"></div>
      <div class="panel rss-panel"><div class="panel-head"><span class="dot"></span>RSS / 每个主题一个 Feed</div><div class="rss-big"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 25a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="currentColor" stroke="none"/><path d="M7 14a11 11 0 0 1 11 11"/><path d="M7 7a18 18 0 0 1 18 18"/></svg><div class="rss-copy">随时刷新 · 收藏稍后读<small>手机、平板、电脑都能读</small></div></div></div>
    </div>
    <a class="cta" href="https://github.com/leigangzhang/twitter-rss"><span class="url">github.com/leigangzhang/twitter-rss</span><span class="go">↗</span></a>
    <div class="note">* 成本按公众号文章发布时的 DeepSeek 用量口径；随模型用量和价格变化，不构成固定报价。</div>
    <div class="rule"></div>
    <div class="footer"><span class="url">公开仓库 · 按自己的名单和规则部署</span><span class="num">03 / 03</span></div>
  </section>
</div>
</body>
</html>'''

html = (
    HTML.replace("@@F400@@", F400)
    .replace("@@F700@@", F700)
    .replace("@@F900@@", F900)
    .replace("@@M400@@", M400)
    .replace("@@M700@@", M700)
    .replace("@@EMAIL@@", EMAIL_IMG)
    .replace("@@SUBSCRIBE@@", SUBSCRIBE_IMG)
)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
