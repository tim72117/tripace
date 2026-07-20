# 桌面版佈局改版規劃:對話為主體、時間軸抽屜化

> 2026-07-20 規劃。範圍:**僅正式產品桌面版**(`/app`,寬度 ≥768px 的 `DesktopContent` 分支),手機版佈局完全不動。已定案的設計決策:切換按鈕採**左側直立功能列 icon rail**(VSCode / Slack 模式)。實作交給 subagent 執行,本文件是實作的依據。

## 一、目標

把桌面版從「時間軸為主體、對話為暫態浮層」反轉成:

1. 主區平時顯示**對話內容**(訊息串常駐,不再是輸入時才浮現的毛玻璃浮層)
2. **時間軸平時不顯示**,需要時從左側功能列滑出
3. LLM 編寫行程時,**行程表格動態出現在對話流中**(參考 debug 工作台剛做的表格形式)

## 二、現況(改版前)

```
┌──────────────┬──────────────────────────────┐
│ desktop-     │ desktop-main                 │
│ sidebar      │  └ ChatScreen(手機桌面共用)   │
│ (272px)      │     ├ navbar(行程名/分享/成員)│
│ ├ 頻道列表    │     ├ screen-body            │
│ │(Desktop-   │     │  └ MultiTrackTimeline   │ ← 時間軸是主體
│ │ ChannelList)│    ├ chat-overlay(毛玻璃浮層) │ ← 有訊息才短暫出現
│ └ 使用者選單  │     └ composer(✨/💬圓鈕)     │
└──────────────┴──────────────────────────────┘
```

關鍵現況事實(規劃時已查證,實作時直接引用):

- 桌面版分支在 `App.tsx` 的 `DesktopContent`(約195行起):`.desktop-layout` > `.desktop-sidebar`(272px,含 `DesktopChannelList` + `DesktopUserMenu`)+ `.desktop-main`(內放 `ChatScreen`)
- `ChatScreen.tsx`(1026行)是手機/桌面共用元件,佈局:navbar → `.chat-area`(`.screen-body` 內是 `MultiTrackTimeline`)→ `.chat-overlay`(條件渲染:`messages.length > 0 || sending || inputFocused`)→ `.composer`
- **對話訊息是暫態的**:owner 在 `load()` 時 `setMessages([])`(第100行,刻意不顯示歷史);點擊 `screen-body` 的 `onMouseDown` 也會 `setMessages([])`(第363行)。訊息本體存在裝置端 DB(`listMessages`,deviceDB),與 server 隔離
- WS 事件已齊備:`entry_updating`(條目開始被改,含 entryID)、`entries_updated`(改完,前端重抓 entries)、`task_created`/`task_entry_ready`、`ask_user`/`ask_choice`、`recommended_places`——行程編排卡片的觸發訊號不需要新增後端事件
- `updatingEntryIDs` state + 最短顯示 800ms 的機制已存在,可直接給表格的變動列高亮復用
- 樣式檔是 `web/src/styles.css`(正式產品,暖色調),debug 表格樣式在 `debug.css`(暗色,`cts-table`)——正式版表格要重做配色,不能直接搬

## 三、新佈局設計

```
┌──┬─────────┬──────────────────────────────────┐
│🗂│ side     │ navbar(行程名/分享/成員)          │
│📅│ panel    │──────────────────────────────────│
│  │          │                                  │
│  │ 內容二選一│        對話訊息串(主體,常駐)      │
│  │ ・頻道列表│                                  │
│  │ ・時間軸  │   ┌────────────────────────┐     │
│  │          │   │ 📋 正在編排行程…         │     │
│  │ (可整個  │   │ ┌────────────────────┐  │     │
│  │  收合)   │   │ │標題  │日期 │時間│備註│  │     │
│  │          │   │ │淺草寺│7/21│10:00│…  │  │ ← 行程編排卡片
│  │          │   │ └────────────────────┘  │  (LLM 操作時動態出現)
│  │          │   └────────────────────────┘     │
│👤│          │  [✨] [輸入框____________] [送出]  │
└──┴─────────┴──────────────────────────────────┘
rail  side panel         main(對話)
48px  272px(頻道)/380px(時間軸)
```

### 3.1 icon rail(新元件,48px 固定)

由上而下:

| 圖示 | 行為 |
|---|---|
| 🗂(頻道/行程清單) | side panel 顯示頻道列表;再點一次收合 panel |
| 📅(時間軸) | side panel 顯示目前行程的時間軸;再點一次收合 panel |
| (第一版就這兩顆,✨推薦維持在 composer 不搬) | |
| 👤(底部,使用者選單) | 現有 `DesktopUserMenu` 移到 rail 底部 |

- 當前啟用的圖示要有視覺標記(左緣 accent 色豎條或底色,比照 VSCode activity bar)
- panel 收合時主區全寬;切換 panel 內容不重新收合(直接換內容)

### 3.2 side panel(改造自現有 desktop-sidebar)

- **頻道列表模式**:寬 272px,內容就是現有 `DesktopChannelList`(不重寫)
- **時間軸模式**:寬 380px(時間軸多欄呈現 272px 不夠;380px 是初值,實作時以 `MultiTrackTimeline` 實際呈現微調),內容是現有 `MultiTrackTimeline`,資料與主區共用同一份 `entries` state
- 收合/展開與寬度切換都要有 CSS transition(約 200ms,push 模式——主區跟著縮放,不是 overlay 蓋在對話上;桌面寬度足夠,push 比 overlay 穩定)
- 預設狀態:**進入桌面版時 panel 開啟且顯示頻道列表**(維持現有使用者習慣:一進來先選行程);選定行程後使用者可自行收合
- 面板寬度拖曳調整(比照 DebugApp 的 resizer)列為次階段,第一版固定寬

### 3.3 主區:對話串常駐

- 移除 `.chat-overlay` 的條件渲染與毛玻璃浮層定位,訊息串改為主區的常駐內容(正常文檔流,由上往下,新訊息在底部,自動捲到最新)
- **行為變更**:owner 的 `load()` 不再 `setMessages([])`,改為載入裝置端 DB 的訊息歷史;`screen-body` 的 `onMouseDown` 清空 messages 的行為移除(桌面版)
- **需查證點(實作前先確認,不要假設)**:owner 送出訊息與 AI 回覆目前有沒有寫進 deviceDB?若 `send()` 流程根本沒存,「顯示歷史」就沒有資料來源,第一版退而求其次:對話串只顯示**本次 session** 的訊息(不清空、不持久化),持久化列為後續項目
- composer 維持現有圓鈕設計不動
- 時間軸從主區移除(只活在 side panel 的時間軸模式裡)
- `ask_user`/`ask_choice`/`recommended_places` 彈窗機制不動

### 3.4 行程編排卡片(對話流中的動態表格)

觸發與生命週期:

1. **出現**:收到第一個 `entry_updating` 或 `entries_updated` WS 事件(即 LLM 這一回合開始動行程)時,在對話串尾端插入一張「行程編排卡片」;同一回合(同一次 send 之後)只插一張,不重複插
2. **進行中**:卡片標頭「正在編排行程…」+ 現有 `WaveLoader` 波浪動畫;卡片內是行程表格(欄位:標題/日期/時間/備註,參考 debug 的 `cts-table` 結構但配色用 styles.css 暖色調),表格資料直接讀主 `entries` state 即時刷新;正在被改的列用現有 `updatingEntryIDs` 高亮(復用 800ms 最短顯示機制)
3. **定格**:AI 回合結束(訊息串收到 AI 的文字回覆,或一段時間沒有新的 entry 事件)後,標頭改為「行程已更新」,波浪動畫停止;卡片保留在對話流中該位置,附一顆「開啟時間軸」按鈕(點了等於按 rail 的 📅)
4. **表格內容範圍**:第一版顯示全部 entries(變動列高亮);「只顯示本回合差集」需要 diff 基準,依賴 CLIENTTOOLS_DESIGN_NOTES / FEATURE_PRIORITIES 裡的 diff 機制,列為後續項目不在本次範圍

### 3.5 手機版不動的保證方式

`ChatScreen` 是共用元件,改動策略:

- 佈局反轉(overlay→常駐、時間軸移除)只在桌面版生效:`ChatScreen` 增加一個 `desktopChat?: boolean` prop(由 `DesktopContent` 傳入),內部以此條件渲染;手機路徑不傳,行為與現在完全一致
- icon rail / side panel 是 `DesktopContent` 層的新結構,完全不碰手機版
- 驗收條件必須包含:手機寬度(<768px)下畫面與行為跟改版前一致

## 四、與 ITINERARY_UX_DESIGN.md 的關係

該文件(2026-07-20 稍早完成)以「時間軸為主體、對話為暫態浮層」為核心原則,是**手機優先**的設計;本次改版把**桌面版**反轉為「對話為主體」。兩者並存的解釋:手機小螢幕上時間軸值得佔滿主畫面,桌面寬螢幕則有空間讓對話與時間軸並排/切換。實作完成後需回頭在 ITINERARY_UX_DESIGN.md 的「2.3 桌面寬版」章節加註記,指向本文件作為桌面版的新方向,避免兩份文件矛盾沒人發現。

## 五、分階段實作計畫(交給 subagent,指定 sonnet)

### 階段 1:桌面版骨架改造

- 新增 icon rail 元件與樣式(styles.css)
- `desktop-sidebar` 改造為可切換內容(頻道列表/時間軸)、可收合的 side panel
- `ChatScreen` 加 `desktopChat` prop:桌面模式下對話串常駐主區、時間軸不渲染在主區、overlay 條件渲染邏輯改為常駐訊息串
- 實作前先查證 deviceDB 是否存 owner 訊息,決定「顯示歷史」還是「僅本次 session」
- 驗收:桌面版三欄佈局如 mockup 運作、rail 切換/收合順暢、手機版完全不變、`tsc` 通過

### 階段 2:行程編排卡片

- 對話流插入卡片的觸發邏輯(WS 事件 + 單回合去重)
- 正式版配色的行程表格元件(可考慮抽成獨立元件,供 side panel 未來的清單檢視復用)
- 進行中/定格兩態、變動列高亮、「開啟時間軸」按鈕
- 驗收:對 LLM 下一句會動行程的指令,卡片如 3.4 生命週期運作;純聊天(不動行程)的回合不出現卡片

### 階段 3(可選,另行確認再做)

- side panel 寬度拖曳
- 對話歷史持久化(若階段 1 查證結果是沒存)
- rail 擴充(推薦、地圖入口)
- ITINERARY_UX_DESIGN.md 2.3 章節修訂
