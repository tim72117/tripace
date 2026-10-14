// AdAffiliateCompareData.ts — 構想八(廣告與聯盟行銷方案比較)的靜態展示
// 頁原始內容。這份內容是完整的獨立靜態頁面(自帶 <style>,不依賴這個
// React 專案的 CSS Modules/token 系統),比較 Google AdSense 跟四家
// 旅遊聯盟行銷平台(KKday/Klook/Booking.com/Agoda)在外觀彈性、整合
// 複雜度、收益等面向的差異——跟既有 /ad-system(構想六:站內贊助版位,
// 原生卡片形式)是不同主題,不是同一個構想的延伸或替代(2026-10 使用者
// 明確確認「這兩個廣告投放不一樣」),故獨立成構想八,不合併進
// AdSystemPage.tsx。
//
// 用 <iframe srcDoc> 而非轉寫成 React 元件嵌入(見 AdAffiliateComparePage.tsx
// 的完整說明)——保留這份內容原有的精確視覺呈現,不冒著逐行轉寫 300+ 行
// CSS 跟巢狀卡片結構時遺漏細節或引入樣式衝突的風險。
export const AD_AFFILIATE_COMPARE_HTML = /* html */ `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>
<title>廣告版位展示</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
  :root {
    --bg: #F7F5F0;
    --surface: #FFFFFF;
    --surface-2: #EFEBE2;
    --ink: #1E2630;
    --ink-soft: #5B6572;
    --line: #DAD4C6;
    --brand: #2B4C6F;
    --brand-soft: #E3EAF1;
    --accent: #E8734A;
    --accent-soft: #FBE4D8;
    --good: #3C7A5E;
    --good-soft: #DEEEE4;
    --mid: #B8863C;
    --mid-soft: #F3E8D4;
    --low: #A14B4B;
    --low-soft: #F3DEDE;
    --shadow: 0 1px 2px rgba(30,38,48,0.06), 0 8px 24px rgba(30,38,48,0.08);
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14181D;
      --surface: #1C2127;
      --surface-2: #242A31;
      --ink: #EDEAE2;
      --ink-soft: #9CA6B2;
      --line: #333B44;
      --brand: #7CA3C9;
      --brand-soft: #22323F;
      --accent: #F08B5F;
      --accent-soft: #3A2A22;
      --good: #6FBE97;
      --good-soft: #1F3329;
      --mid: #D9AC63;
      --mid-soft: #3A3020;
      --low: #D98181;
      --low-soft: #3A2424;
      --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.4);
    }
  }
  :root[data-theme="dark"] {
    --bg: #14181D;
    --surface: #1C2127;
    --surface-2: #242A31;
    --ink: #EDEAE2;
    --ink-soft: #9CA6B2;
    --line: #333B44;
    --brand: #7CA3C9;
    --brand-soft: #22323F;
    --accent: #F08B5F;
    --accent-soft: #3A2A22;
    --good: #6FBE97;
    --good-soft: #1F3329;
    --mid: #D9AC63;
    --mid-soft: #3A3020;
    --low: #D98181;
    --low-soft: #3A2424;
    --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.4);
  }

  * { box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: 'Inter', -apple-system, 'Noto Sans TC', sans-serif;
    padding: clamp(20px, 4vw, 56px) 20px 64px;
  }
  .wrap { max-width: 1120px; margin: 0 auto; }

  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

  header.page {
    margin-bottom: 40px;
    max-width: 680px;
  }
  .eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 600;
    margin: 0 0 12px;
  }
  h1 {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(28px, 4vw, 38px);
    line-height: 1.15;
    letter-spacing: -0.01em;
    margin: 0 0 14px;
    text-wrap: balance;
    color: var(--ink);
  }
  header.page p {
    font-size: 15.5px;
    line-height: 1.65;
    color: var(--ink-soft);
    margin: 0;
    max-width: 62ch;
  }

  h2.section-title {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 21px;
    margin: 0 0 4px;
    color: var(--ink);
  }
  .section-sub {
    font-size: 13.5px;
    color: var(--ink-soft);
    margin: 0 0 20px;
  }
  section.block { margin-bottom: 52px; }
  section.block:last-of-type { margin-bottom: 36px; }

  /* ---- mock browser frame ---- */
  .frame {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .frame-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--line);
  }
  .frame-bar .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
  .frame-bar .url {
    margin-left: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--ink-soft);
    background: var(--bg);
    border-radius: 5px;
    padding: 3px 10px;
    flex: 1;
    max-width: 240px;
  }
  .frame-body { padding: 18px; }

  /* ---- grid for the two-up demos ---- */
  .demo-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 22px;
  }
  @media (max-width: 720px) {
    .demo-grid { grid-template-columns: 1fr; }
  }

  .demo-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .demo-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .demo-label .name { font-weight: 600; font-size: 14px; }
  .demo-label .tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.03em;
    color: var(--ink-soft);
  }

  /* ---- homepage card feed mock ---- */
  .feed-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  @media (max-width: 720px) { .feed-grid { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 480px) { .feed-grid { grid-template-columns: 1fr; } }
  .feed-card {
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface);
  }
  .feed-card .feed-thumb {
    height: 76px;
    background: linear-gradient(135deg, var(--brand-soft), var(--line));
  }
  .feed-card .feed-body { padding: 10px 12px; }
  .feed-card .feed-title { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
  .feed-card .feed-sub { font-size: 11.5px; color: var(--ink-soft); }

  /* ---- article page mock ---- */
  .article-mock { display: flex; flex-direction: column; gap: 14px; }
  .article-mock h3 {
    font-family: 'Fraunces', serif;
    font-size: 19px;
    font-weight: 600;
    margin: 0;
  }
  .article-mock .lede { font-size: 13px; color: var(--ink-soft); line-height: 1.6; }
  .article-mock p.body-text { font-size: 13px; line-height: 1.75; color: var(--ink); margin: 0; }

  /* ---- sidebar layout mock (map page) ---- */
  .map-layout {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: 14px;
  }
  @media (max-width: 640px) { .map-layout { grid-template-columns: 1fr; } }
  .map-canvas {
    border-radius: 8px;
    min-height: 220px;
    background:
      radial-gradient(circle at 30% 30%, var(--brand-soft), transparent 55%),
      radial-gradient(circle at 70% 60%, var(--accent-soft), transparent 50%),
      var(--surface-2);
    position: relative;
    border: 1px solid var(--line);
  }
  .map-pin {
    position: absolute;
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--brand);
    box-shadow: 0 0 0 3px var(--surface);
  }
  .map-sidebar { display: flex; flex-direction: column; gap: 10px; }
  .map-sidebar .sidebar-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* ---- itinerary mock content ---- */
  .itin-row {
    display: flex;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .itin-row:last-child { border-bottom: none; }
  .itin-time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--ink-soft);
    width: 46px;
    flex-shrink: 0;
    padding-top: 2px;
  }
  .itin-main { flex: 1; min-width: 0; }
  .itin-title { font-weight: 600; font-size: 14px; margin-bottom: 2px; }
  .itin-sub { font-size: 12.5px; color: var(--ink-soft); }

  /* ---- AdSense display unit ---- */
  .ad-display {
    background: var(--surface-2);
    border: 1px dashed var(--line);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .ad-display .ph-img {
    width: 64px; height: 64px;
    border-radius: 6px;
    background: linear-gradient(135deg, var(--brand-soft), var(--line));
    flex-shrink: 0;
  }
  .ad-display .ph-text { flex: 1; }
  .ad-display .ad-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 6px;
    display: inline-block;
    margin-bottom: 6px;
  }
  .ph-line { height: 8px; border-radius: 4px; background: var(--line); margin-bottom: 6px; }
  .ph-line.w70 { width: 70%; }
  .ph-line.w40 { width: 40%; }

  /* ---- in-feed ad (inside itinerary list) ---- */
  .ad-infeed {
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .ad-infeed .ph-icon {
    width: 34px; height: 34px;
    border-radius: 7px;
    background: var(--accent);
    opacity: 0.35;
    flex-shrink: 0;
  }
  .ad-infeed .ad-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: var(--accent);
    font-weight: 600;
  }

  /* ---- affiliate banner (KKday/Klook style) ---- */
  .ad-banner {
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    background: linear-gradient(120deg, #2B4C6F, #3E6690);
    padding: 16px;
    color: #F5F2EC;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 92px;
    justify-content: center;
  }
  .ad-banner .banner-eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.75;
  }
  .ad-banner .banner-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; }
  .ad-banner .banner-cta {
    margin-top: 4px;
    display: inline-flex;
    align-self: flex-start;
    font-size: 11.5px;
    font-weight: 600;
    background: rgba(245,242,236,0.16);
    padding: 4px 10px;
    border-radius: 100px;
  }

  /* ---- deeplink inline card (in itinerary flow) ---- */
  .ad-deeplink {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
  }
  .ad-deeplink .dl-icon {
    width: 30px; height: 30px;
    border-radius: 7px;
    background: var(--good-soft);
    color: var(--good);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }
  .ad-deeplink .dl-main { flex: 1; min-width: 0; }
  .ad-deeplink .dl-title { font-size: 13px; font-weight: 600; }
  .ad-deeplink .dl-sub { font-size: 11.5px; color: var(--ink-soft); }
  .ad-deeplink .dl-arrow { color: var(--good); font-size: 16px; flex-shrink: 0; }

  /* ---- booking search box widget ---- */
  .ad-searchbox {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px;
    background: var(--brand-soft);
  }
  .ad-searchbox .sb-title {
    font-size: 12.5px;
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--brand);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sb-fields {
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr;
    gap: 6px;
    margin-bottom: 8px;
  }
  .sb-field {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
  }
  .sb-field .sb-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
    margin-bottom: 2px;
  }
  .sb-field .sb-value { font-size: 12px; font-weight: 500; }
  .sb-submit {
    width: 100%;
    background: var(--brand);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 7px 0;
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
  }

  /* ---- in-article ad ---- */
  .ad-inarticle {
    text-align: center;
    padding: 20px 10px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .ad-inarticle .ad-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: var(--ink-soft);
    letter-spacing: 0.05em;
  }
  .ad-inarticle .ph-block {
    margin-top: 10px;
    height: 48px;
    border-radius: 6px;
    background: var(--surface-2);
    border: 1px dashed var(--line);
  }

  /* ---- flexibility meter ---- */
  .meter-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }
  .meter-track {
    flex: 1;
    height: 6px;
    border-radius: 100px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .meter-fill { height: 100%; border-radius: 100px; }
  .meter-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: var(--ink-soft);
    white-space: nowrap;
    width: 72px;
    text-align: right;
  }

  /* ---- comparison table ---- */
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
  }
  table.compare {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    min-width: 680px;
  }
  table.compare th, table.compare td {
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  table.compare thead th {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft);
    background: var(--surface-2);
    font-weight: 600;
  }
  table.compare tbody tr:last-child td { border-bottom: none; }
  table.compare td.fmt { font-weight: 600; }
  .pill {
    display: inline-block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 100px;
  }
  .pill.good { background: var(--good-soft); color: var(--good); }
  .pill.mid { background: var(--mid-soft); color: var(--mid); }
  .pill.low { background: var(--low-soft); color: var(--low); }

  footer.note {
    margin-top: 44px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    font-size: 12.5px;
    color: var(--ink-soft);
    line-height: 1.6;
  }

  /* ---- revenue bar chart ---- */
  .rev-chart { display: flex; flex-direction: column; gap: 16px; }
  .rev-row { display: grid; grid-template-columns: 110px 1fr 108px; align-items: center; gap: 12px; }
  @media (max-width: 560px) { .rev-row { grid-template-columns: 76px 1fr 86px; gap: 8px; } }
  .rev-name { font-size: 13px; font-weight: 600; }
  .rev-unit { font-size: 10.5px; color: var(--ink-soft); display: block; margin-top: 1px; }
  .rev-track {
    height: 22px;
    border-radius: 6px;
    background: var(--surface-2);
    overflow: hidden;
    position: relative;
  }
  .rev-fill {
    height: 100%;
    border-radius: 6px;
    background: var(--brand);
    display: flex;
    align-items: center;
  }
  .rev-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .rev-value .unit { font-size: 11px; color: var(--ink-soft); font-weight: 500; }
  .rev-caveat {
    font-size: 10.5px;
    color: var(--ink-soft);
  }

  /* ---- note callout ---- */
  .callout {
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 0 8px 8px 0;
    padding: 12px 16px;
    font-size: 13px;
    line-height: 1.65;
  }
  .callout strong { color: var(--accent); }
</style>

<div class="wrap">
  <header class="page">
    <p class="eyebrow">Tripace · 廣告與聯盟版位展示</p>
    <h1>把廣告放進行程頁，長什麼樣子</h1>
    <p>以下用 Tripace 的行程編輯畫面當容器，模擬四種可掛上的廣告 / 聯盟行銷型態，並比較各自在外觀上能調整的空間。深色文字框代表廣告本身的留白區域，非真實素材。</p>
  </header>

  <section class="block">
    <h2 class="section-title">AdSense — 首頁景點卡片牆</h2>
    <p class="section-sub">首頁用卡片列表呈現主題景點頁，In-feed 廣告混進第四格，樣式跟著列表延展，但無法染上 Tripace 的配色</p>
    <div class="frame">
      <div class="frame-bar">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
        <div class="url">tripace.shuttle.tools /</div>
      </div>
      <div class="frame-body">
        <div style="font-size:12px; font-weight:600; color:var(--ink-soft); margin-bottom:10px;">熱門主題景點</div>
        <div class="feed-grid">
          <div class="feed-card">
            <div class="feed-thumb"></div>
            <div class="feed-body"><div class="feed-title">九份老街</div><div class="feed-sub">山城夜景 · 步行路線</div></div>
          </div>
          <div class="feed-card">
            <div class="feed-thumb" style="background:linear-gradient(135deg, var(--accent-soft), var(--line));"></div>
            <div class="feed-body"><div class="feed-title">京都清水寺</div><div class="feed-sub">古寺巡禮 · 半日行程</div></div>
          </div>
          <div class="feed-card">
            <div class="feed-thumb" style="background:linear-gradient(135deg, var(--good-soft), var(--line));"></div>
            <div class="feed-body"><div class="feed-title">台南安平</div><div class="feed-sub">老街美食 · 親子友善</div></div>
          </div>
          <div class="feed-card" style="border-color:transparent;">
            <div class="ad-infeed" style="height:76px; border-radius:0; align-items:center;">
              <div class="ph-icon"></div>
              <div><span class="ad-chip">廣告 · In-feed</span><div style="font-size:11px; margin-top:2px;">卡片外框跟隨，底色不可自訂</div></div>
            </div>
            <div class="feed-body" style="padding-top:6px;"><div class="ph-line w70" style="margin-bottom:0;"></div></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">AdSense — /product 介紹頁段落間</h2>
    <p class="section-sub">Display 橫幅插在頁首，In-article 插在段落中間；2026 年新規定下兩者都只能調尺寸，文字配色由 Google 系統決定</p>
    <div class="frame">
      <div class="frame-bar">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
        <div class="url">tripace.shuttle.tools /product</div>
      </div>
      <div class="frame-body article-mock">
        <h3>用一句話，排出一整天的行程</h3>
        <p class="lede">Tripace 讀懂你隨手打的描述，自動整理成帶時間軸的行程條目。</p>
        <div class="ad-display">
          <div class="ph-img"></div>
          <div class="ph-text"><span class="ad-chip">廣告</span><div class="ph-line w70"></div><div class="ph-line w40"></div></div>
        </div>
        <p class="body-text">只要打「早上先去清水寺，中午在祇園吃飯」，AI 就會抓出地點與順序，自動排進時間軸，並補上預估停留時間與交通方式。</p>
        <div class="ad-inarticle">
          <span class="ad-chip">· Sponsored ·</span>
          <div class="ph-block"></div>
        </div>
        <p class="body-text">支援多人即時協作，也能產生免登入的分享連結，讓同行的朋友一起調整行程順序。</p>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">AdSense 在手機寬度下的實際顯示</h2>
    <p class="section-sub">同兩個版位縮到 ~390px 檢視：卡片牆從三欄變兩欄，In-feed 廣告格跟著變窄；Display 橫幅的左側圖片在窄版會被壓縮，文字跟著換行</p>
    <div class="demo-grid">
      <div class="demo-card">
        <div class="demo-label"><span class="name">首頁卡片牆 · 手機版</span><span class="tag mono">iPhone SE ≈ 375px</span></div>
        <div class="frame" style="max-width:300px;">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">tripace.shuttle.tools /</div></div>
          <div class="frame-body">
            <div style="font-size:11px; font-weight:600; color:var(--ink-soft); margin-bottom:8px;">熱門主題景點</div>
            <div class="feed-grid">
              <div class="feed-card">
                <div class="feed-thumb" style="height:58px;"></div>
                <div class="feed-body" style="padding:8px 9px;"><div class="feed-title" style="font-size:11.5px;">九份老街</div><div class="feed-sub" style="font-size:10px;">山城夜景</div></div>
              </div>
              <div class="feed-card">
                <div class="feed-thumb" style="height:58px; background:linear-gradient(135deg, var(--accent-soft), var(--line));"></div>
                <div class="feed-body" style="padding:8px 9px;"><div class="feed-title" style="font-size:11.5px;">清水寺</div><div class="feed-sub" style="font-size:10px;">古寺巡禮</div></div>
              </div>
              <div class="feed-card" style="border-color:transparent; grid-column: span 2;">
                <div class="ad-infeed" style="height:56px; border-radius:0; align-items:center;">
                  <div class="ph-icon" style="width:28px; height:28px;"></div>
                  <div><span class="ad-chip">廣告 · In-feed</span><div style="font-size:10px; margin-top:2px;">兩欄並滿時會獨佔一整行</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="demo-card">
        <div class="demo-label"><span class="name">/product 段落間 · 手機版</span><span class="tag mono">iPhone SE ≈ 375px</span></div>
        <div class="frame" style="max-width:300px;">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">/product</div></div>
          <div class="frame-body article-mock" style="gap:10px;">
            <h3 style="font-size:16px;">用一句話，排出一整天的行程</h3>
            <div class="ad-display" style="padding:10px; gap:8px;">
              <div class="ph-img" style="width:44px; height:44px;"></div>
              <div class="ph-text"><span class="ad-chip" style="font-size:8.5px;">廣告</span><div class="ph-line w70" style="height:6px;"></div><div class="ph-line w40" style="height:6px;"></div></div>
            </div>
            <p class="body-text" style="font-size:12px;">只要打「早上先去清水寺」，AI 就會自動排進時間軸。</p>
            <div class="ad-inarticle" style="padding:14px 6px;">
              <span class="ad-chip" style="font-size:8px;">· Sponsored ·</span>
              <div class="ph-block" style="height:40px;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">KKday 橫幅——放進行程時間軸，只能換素材圖</h2>
    <p class="section-sub">三則橫幅插進同一份行程，外框、留白、文字排列完全相同，差異只在挑選的商品素材</p>
    <div class="frame">
      <div class="frame-bar">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
        <div class="url">tripace.shuttle.tools /app</div>
      </div>
      <div class="frame-body">
        <div class="itin-row">
          <div class="itin-time">09:00</div>
          <div class="itin-main"><div class="itin-title">關西機場抵達</div><div class="itin-sub">入境・提領行李</div></div>
        </div>
        <div class="itin-row">
          <div class="itin-time"></div>
          <div class="itin-main">
            <div class="ad-banner" style="background: linear-gradient(120deg, #5A4A3C, #7A6650); min-height:72px;">
              <span class="banner-eyebrow">KKday · 機場接送</span>
              <span class="banner-title">關西機場 → 市區 專車</span>
              <span class="banner-cta">立即預訂 →</span>
            </div>
          </div>
        </div>
        <div class="itin-row">
          <div class="itin-time">14:00</div>
          <div class="itin-main"><div class="itin-title">嵐山竹林小徑</div><div class="itin-sub">步行約 40 分鐘</div></div>
        </div>
        <div class="itin-row">
          <div class="itin-time"></div>
          <div class="itin-main">
            <div class="ad-banner" style="background: linear-gradient(120deg, #3C5A3E, #567558); min-height:72px;">
              <span class="banner-eyebrow">KKday · 本地票券</span>
              <span class="banner-title">關西周遊券 3 日版</span>
              <span class="banner-cta">立即預訂 →</span>
            </div>
          </div>
        </div>
        <div class="itin-row">
          <div class="itin-time">16:30</div>
          <div class="itin-main"><div class="itin-title">祇園散策</div><div class="itin-sub">和服體驗熱門時段</div></div>
        </div>
        <div class="itin-row">
          <div class="itin-time"></div>
          <div class="itin-main">
            <div class="ad-banner" style="background: linear-gradient(120deg, #4A3C5A, #665078); min-height:72px;">
              <span class="banner-eyebrow">KKday · 和服體驗</span>
              <span class="banner-title">京都和服租借當日往返</span>
              <span class="banner-cta">立即預訂 →</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">Klook Widget——同一份行程，切換語言與追蹤標籤</h2>
    <p class="section-sub">卡片外框與按鈕樣式不能改，但可依使用者語言顯示對應文案、依流量來源帶不同 UTM 標籤</p>
    <div class="demo-grid">
      <div class="demo-card">
        <div class="demo-label"><span class="name">繁中使用者 · 部落格導流</span><span class="tag mono">utm_source=blog</span></div>
        <div class="frame">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">/app?lang=zh-TW</div></div>
          <div class="frame-body" style="padding:12px;">
            <div class="itin-row" style="padding-top:0;"><div class="itin-time">14:00</div><div class="itin-main"><div class="itin-title">嵐山竹林小徑</div></div></div>
            <div class="itin-row" style="border-bottom:none; padding-bottom:0;"><div class="itin-time"></div><div class="itin-main">
              <div class="ad-banner" style="background: linear-gradient(120deg, #2B4C6F, #3E6690); min-height:72px;">
                <span class="banner-eyebrow">Klook · 推薦體驗</span>
                <span class="banner-title">竹林與保津川遊船套票</span>
                <span class="banner-cta">查看票價 →</span>
              </div>
            </div></div>
          </div>
        </div>
      </div>
      <div class="demo-card">
        <div class="demo-label"><span class="name">英文使用者 · EDM 導流</span><span class="tag mono">utm_medium=email</span></div>
        <div class="frame">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">/app?lang=en</div></div>
          <div class="frame-body" style="padding:12px;">
            <div class="itin-row" style="padding-top:0;"><div class="itin-time">14:00</div><div class="itin-main"><div class="itin-title">Arashiyama Bamboo Grove</div></div></div>
            <div class="itin-row" style="border-bottom:none; padding-bottom:0;"><div class="itin-time"></div><div class="itin-main">
              <div class="ad-banner" style="background: linear-gradient(120deg, #2B4C6F, #3E6690); min-height:72px;">
                <span class="banner-eyebrow">Klook · Recommended</span>
                <span class="banner-title">Bamboo Grove & Boat Ride</span>
                <span class="banner-cta">See prices →</span>
              </div>
            </div></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">聯盟 Deeplink——嵌進自家卡片，樣式完全自主</h2>
    <p class="section-sub">純連結導向，外觀由 Tripace 自己刻，放進三個不同頁面情境，各自配色與排法都貼合所在容器</p>
    <div class="demo-grid">
      <div class="demo-card">
        <div class="demo-label"><span class="name">行程時間軸內嵌</span><span class="tag mono">/app</span></div>
        <div class="frame">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">tripace.shuttle.tools /app</div></div>
          <div class="frame-body">
            <div class="itin-row"><div class="itin-time">09:30</div><div class="itin-main"><div class="itin-title">清水寺</div><div class="itin-sub">參觀約 90 分鐘 · 京都市東山區</div></div></div>
            <div class="itin-row" style="border-bottom:none;"><div class="itin-time"></div><div class="itin-main">
              <div class="ad-deeplink">
                <div class="dl-icon">🎫</div>
                <div class="dl-main"><div class="dl-title">清水寺周邊體驗票券</div><div class="dl-sub">KKday 深連結 · 文字配色跟隨 Tripace</div></div>
                <div class="dl-arrow">→</div>
              </div>
            </div></div>
          </div>
        </div>
      </div>
      <div class="demo-card">
        <div class="demo-label"><span class="name">地圖地點彈窗內嵌</span><span class="tag mono">/app（地圖模式）</span></div>
        <div class="frame">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">tripace.shuttle.tools /app/map</div></div>
          <div class="frame-body map-layout">
            <div class="map-canvas">
              <div class="map-pin" style="top:38%; left:42%;"></div>
              <div class="map-pin" style="top:60%; left:62%; background:var(--accent);"></div>
            </div>
            <div class="map-sidebar">
              <div class="sidebar-title">金閣寺</div>
              <div class="itin-sub" style="margin-bottom:4px;">參觀約 60 分鐘</div>
              <div class="ad-deeplink" style="background:var(--brand-soft); border-color:transparent;">
                <div class="dl-icon" style="background:var(--brand); color:#fff;">🏯</div>
                <div class="dl-main"><div class="dl-title" style="font-size:12px;">入場 + 導覽</div><div class="dl-sub" style="font-size:10.5px;">融入地點卡底色</div></div>
                <div class="dl-arrow" style="color:var(--brand); font-size:14px;">→</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="demo-grid" style="margin-top:22px;">
      <div class="demo-card">
        <div class="demo-label"><span class="name">主題景點頁側邊欄推薦卡</span><span class="tag mono">/jiufen</span></div>
        <div class="frame">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">tripace.shuttle.tools /jiufen</div></div>
          <div class="frame-body" style="display:grid; grid-template-columns:1fr 160px; gap:14px;">
            <div class="article-mock">
              <h3 style="font-size:16px;">九份老街散策指南</h3>
              <p class="body-text" style="font-size:12.5px;">沿著階梯老街往上走，傍晚時分可以看見整座山城點燈，是最熱門的拍照時刻。</p>
            </div>
            <div class="map-sidebar">
              <div class="sidebar-title">相關體驗</div>
              <div class="ad-deeplink" style="flex-direction:column; align-items:flex-start; gap:6px; background:var(--accent-soft); border-color:transparent; padding:10px;">
                <div class="dl-icon" style="background:var(--accent); color:#fff;">🍜</div>
                <div class="dl-main"><div class="dl-title" style="font-size:12px;">九份芋圓體驗行程</div><div class="dl-sub" style="font-size:10.5px;">完全貼合側欄寬度</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="demo-card">
        <div class="demo-label"><span class="name">同一張卡在手機寬度下</span><span class="tag mono">~400px</span></div>
        <div class="frame" style="max-width:280px;">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">/jiufen</div></div>
          <div class="frame-body">
            <div class="sidebar-title" style="margin-bottom:8px;">相關體驗</div>
            <div class="ad-deeplink" style="flex-direction:column; align-items:flex-start; gap:6px; background:var(--accent-soft); border-color:transparent; padding:10px;">
              <div class="dl-icon" style="background:var(--accent); color:#fff;">🍜</div>
              <div class="dl-main"><div class="dl-title" style="font-size:12px;">九份芋圓體驗行程</div><div class="dl-sub" style="font-size:10.5px;">寬度跟著容器收縮</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">Booking.com Search Box——配色可完全跟隨網站主題</h2>
    <p class="section-sub">同一個搜尋表單元件放進「今晚住宿」條目，換三套配色示範可配色的實際效果</p>
    <div class="demo-grid">
      <div class="demo-card">
        <div class="demo-label"><span class="name">跟隨 Tripace 品牌藍</span><span class="tag mono">brand theme</span></div>
        <div class="frame">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">/app</div></div>
          <div class="frame-body">
            <div class="itin-row" style="padding-top:0;"><div class="itin-time">18:00</div><div class="itin-main"><div class="itin-title">今晚住宿</div><div class="itin-sub">尚未指定地點</div></div></div>
            <div class="itin-row" style="border-bottom:none; padding-bottom:0;"><div class="itin-time"></div><div class="itin-main">
              <div class="ad-searchbox">
                <div class="sb-title">🔍 搜尋京都住宿</div>
                <div class="sb-fields">
                  <div class="sb-field"><div class="sb-label">目的地</div><div class="sb-value">京都</div></div>
                  <div class="sb-field"><div class="sb-label">入住</div><div class="sb-value">10/18</div></div>
                  <div class="sb-field"><div class="sb-label">退房</div><div class="sb-value">10/19</div></div>
                </div>
                <button class="sb-submit">搜尋空房</button>
              </div>
            </div></div>
          </div>
        </div>
      </div>
      <div class="demo-card">
        <div class="demo-label"><span class="name">深色模式下的沉穩版</span><span class="tag mono">dark surface</span></div>
        <div class="frame">
          <div class="frame-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="url">/app</div></div>
          <div class="frame-body">
            <div class="itin-row" style="padding-top:0;"><div class="itin-time">18:00</div><div class="itin-main"><div class="itin-title">今晚住宿</div><div class="itin-sub">尚未指定地點</div></div></div>
            <div class="itin-row" style="border-bottom:none; padding-bottom:0;"><div class="itin-time"></div><div class="itin-main">
              <div class="ad-searchbox" style="background:var(--ink); color:var(--bg);">
                <div class="sb-title" style="color:var(--bg);">🔍 搜尋京都住宿</div>
                <div class="sb-fields">
                  <div class="sb-field" style="background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.15);"><div class="sb-label" style="color:rgba(255,255,255,0.6);">目的地</div><div class="sb-value" style="color:var(--bg);">京都</div></div>
                  <div class="sb-field" style="background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.15);"><div class="sb-label" style="color:rgba(255,255,255,0.6);">入住</div><div class="sb-value" style="color:var(--bg);">10/18</div></div>
                  <div class="sb-field" style="background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.15);"><div class="sb-label" style="color:rgba(255,255,255,0.6);">退房</div><div class="sb-value" style="color:var(--bg);">10/19</div></div>
                </div>
                <button class="sb-submit" style="background:var(--bg); color:var(--ink);">搜尋空房</button>
              </div>
            </div></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">自訂彈性總量尺</h2>
    <p class="section-sub">量尺代表能調整版型、配色、佈局的空間大小，越長代表彈性越高——對照上方各組範例的變化幅度</p>
    <div style="display:flex; flex-direction:column; gap:14px;">
      <div>
        <div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:600;">Booking.com Search Box / XML Feed</span><span class="mono" style="color:var(--ink-soft); font-size:11.5px;">可配色・可自建版型</span></div>
        <div class="meter-row"><div class="meter-track"><div class="meter-fill" style="width:92%; background:var(--good);"></div></div><div class="meter-label">高</div></div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:600;">聯盟 Deeplink（純連結嵌入自家卡片）</span><span class="mono" style="color:var(--ink-soft); font-size:11.5px;">版型完全自主</span></div>
        <div class="meter-row"><div class="meter-track"><div class="meter-fill" style="width:85%; background:var(--good);"></div></div><div class="meter-label">高</div></div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:600;">Klook Widget（搜尋框／推薦卡）</span><span class="mono" style="color:var(--ink-soft); font-size:11.5px;">語言・UTM 可調</span></div>
        <div class="meter-row"><div class="meter-track"><div class="meter-fill" style="width:55%; background:var(--mid);"></div></div><div class="meter-label">中</div></div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:600;">KKday 橫幅 Banner</span><span class="mono" style="color:var(--ink-soft); font-size:11.5px;">僅可選圖片素材</span></div>
        <div class="meter-row"><div class="meter-track"><div class="meter-fill" style="width:30%; background:var(--low);"></div></div><div class="meter-label">低</div></div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:600;">Google AdSense（Display / In-feed / In-article）</span><span class="mono" style="color:var(--ink-soft); font-size:11.5px;">僅可選尺寸・版位</span></div>
        <div class="meter-row"><div class="meter-track"><div class="meter-fill" style="width:18%; background:var(--low);"></div></div><div class="meter-label">最低</div></div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">收益比較——每千次曝光／點擊的預期收益</h2>
    <p class="section-sub">AdSense 是「曝光」計價，其餘四家是「點擊後完成訂單」計價，兩種單位不能直接相加，但可用來判斷優先投入順序</p>
    <div class="rev-chart">
      <div class="rev-row">
        <div><span class="rev-name">Agoda</span><span class="rev-unit">每 1000 次點擊</span></div>
        <div class="rev-track"><div class="rev-fill" style="width:100%; background:var(--good);"></div></div>
        <div class="rev-value">$52<span class="unit"> USD</span></div>
      </div>
      <div class="rev-row">
        <div><span class="rev-name">Klook</span><span class="rev-unit">每 1000 次點擊</span></div>
        <div class="rev-track"><div class="rev-fill" style="width:69%; background:var(--brand);"></div></div>
        <div class="rev-value">$36<span class="unit"> USD</span></div>
      </div>
      <div class="rev-row">
        <div><span class="rev-name">KKday</span><span class="rev-unit">每 1000 次點擊</span></div>
        <div class="rev-track"><div class="rev-fill" style="width:63%; background:var(--brand);"></div></div>
        <div class="rev-value">$33<span class="unit"> USD</span></div>
      </div>
      <div class="rev-row">
        <div><span class="rev-name">Booking.com</span><span class="rev-unit">每 1000 次點擊</span></div>
        <div class="rev-track"><div class="rev-fill" style="width:58%; background:var(--mid);"></div></div>
        <div class="rev-value">$30<span class="unit"> USD</span></div>
      </div>
      <div class="rev-row">
        <div><span class="rev-name">AdSense</span><span class="rev-unit">每 1000 次曝光</span></div>
        <div class="rev-track"><div class="rev-fill" style="width:12%; background:var(--low);"></div></div>
        <div class="rev-value">$3–8<span class="unit"> USD</span></div>
      </div>
    </div>
    <div class="callout" style="margin-top:20px;">
      <strong>Klook 最值得優先做</strong>：資料最完整透明（分品類佣金、cookie 天數明確），且 eSIM 佣金高達 20%，與「規劃行程時推薦票券」的高意圖場景契合。<strong>Agoda 數字最高但可信度最低</strong>（官方無公開客單價，新站會落在最低 4% 佣金檔）。<strong>Booking.com 2025/6 起改為 session-based 追蹤</strong>，不再是 30 天 cookie，使用者「先規劃、晚點訂房」的行為模式下可能難以歸因到轉換。AdSense 數字明顯落後一整個量級，建議只當保底收益，不作為主力。
    </div>
  </section>

  <section class="block">
    <h2 class="section-title">整體比較</h2>
    <div class="table-wrap">
      <table class="compare">
        <thead>
          <tr>
            <th>方案</th>
            <th>申請門檻</th>
            <th>外觀自訂</th>
            <th>整合複雜度</th>
            <th>與產品契合度</th>
            <th>收益／千次</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="fmt">AdSense</td>
            <td><span class="pill good">低</span>（審核快，但內容量需足夠）</td>
            <td><span class="pill low">低</span>（僅選尺寸版位）</td>
            <td><span class="pill good">低</span>（GTM 貼標籤）</td>
            <td><span class="pill low">低</span>（意圖不符）</td>
            <td>US$3–8<span class="rev-caveat">／千次曝光</span></td>
          </tr>
          <tr>
            <td class="fmt">KKday</td>
            <td><span class="pill good">低</span>（Ecomobi 約 24hr 審核）</td>
            <td><span class="pill low">低</span>（橫幅僅可選素材）</td>
            <td><span class="pill good">低</span>（純連結／Deeplink）</td>
            <td><span class="pill mid">中</span></td>
            <td>US$33<span class="rev-caveat">／千次點擊</span></td>
          </tr>
          <tr>
            <td class="fmt">Klook</td>
            <td><span class="pill good">低</span>（Involve Asia 約 2 工作日）</td>
            <td><span class="pill mid">中</span>（語言／UTM 可調）</td>
            <td><span class="pill mid">中</span>（Widget 需嵌入 script）</td>
            <td><span class="pill good">高</span></td>
            <td>US$36<span class="rev-caveat">／千次點擊</span></td>
          </tr>
          <tr>
            <td class="fmt">Booking.com</td>
            <td><span class="pill good">低</span>（Awin/CJ 無流量門檻）</td>
            <td><span class="pill good">高</span>（可配色，XML Feed 可全自訂）</td>
            <td><span class="pill mid">低～高</span>（視 Feed 與否）</td>
            <td><span class="pill good">高</span>（住宿場景直接對應）</td>
            <td>US$30<span class="rev-caveat">／千次點擊（歸因風險較高）</span></td>
          </tr>
          <tr>
            <td class="fmt">Agoda</td>
            <td><span class="pill mid">中</span>（CJ 開放地區有限）</td>
            <td><span class="pill low">低</span>（制式橫幅／連結）</td>
            <td><span class="pill good">低</span>（純連結）</td>
            <td><span class="pill mid">中</span></td>
            <td>US$52<span class="rev-caveat">／千次點擊（類比推算，可信度較低）</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <footer class="note">
    畫面中的文字、圖片與數值為示意素材，非真實廣告內容或聯盟後台截圖。實際版位尺寸與規則請以各平台（Google AdSense、Klook Affiliate、KKday Partners、Booking.com Partner Centre、Agoda Partners）當前文件為準；收益數字為區間估算，受流量品質、轉換率與地區差異影響甚大，不代表實際保證收益。
  </footer>
</div>

</body></html>`
