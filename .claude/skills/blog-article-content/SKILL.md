---
name: blog-article-content
description: tripace 部落格文章/主題介紹頁(content_pages)的內容 JSON 格式規則——段落、單圖、多圖群組、站點卡片、捲動時間軸這幾種區塊怎麼寫、各自的排版欄位怎麼選、整篇怎麼組裝並透過 CLI 寫入。觸發語如「寫文章」「加圖片進文章」「文章排版」「多圖排列」「站點卡片」「content-page」。
---

# blog-article-content

tripace 的部落格文章／主題介紹頁內容（`content_pages` 表，前端型別定義在 `web/src/blog/types.ts`）是一份扁平的 `blocks` 陣列，由多種 `kind` 的區塊組成，陣列順序即渲染順序。這份 skill 整理每種區塊怎麼寫、排版欄位怎麼選，以及怎麼透過 CLI 寫入。

**寫文章前，先確認圖片已經上傳並知道對應的 `photoId`**——見下方「圖片怎麼接進文章」一節，不要在內容 JSON 裡直接寫檔名或外部網址。

## 核心概念：扁平陣列，不是巢狀樹

`blocks` 是一個扁平聯集陣列，不是「站點為頂層容器、站內才能放圖片」的固定模板。一篇純文字長文可以全部由 `paragraph` 組成，一篇逐站介紹（像赤崁・府城那種兩日遊）可以幾乎全是 `stop`，兩者沒有優劣之分，依內容性質選用。

```json
{
  "version": 1,
  "slug": "example-slug",
  "title": "文章標題",
  "eyebrow": "副標籤(選填)",
  "lede": "開場介紹段落(選填)",
  "heroPhotoId": "upf_xxxxx",
  "heroStandalonePhotoId": "upf_yyyyy",
  "preferredTheme": "dark",
  "palette": "paper-warm",
  "status": "published",
  "blocks": [ /* 下面各種 kind 混合排列 */ ]
}
```

- `version` 固定填 `1`。
- `heroPhotoId` 選填，`photoId`（同下方「圖片怎麼接進文章」的引用方式），讓這篇文章的 Hero 區塊用全寬背景圖呈現（文字疊在圖上，深色漸層遮罩+白字）。省略時 Hero 維持純文字排版。
- `heroStandalonePhotoId` 選填，`photoId`，在標題區塊下方另外放一張獨立的全幅定場大圖（呼應傳統遊記開頭放一張代表照的版面，不疊字）。跟 `heroPhotoId` 是兩種獨立呈現方式，可以同時使用（各自引用不同或相同的照片），也可以只用其中一種或都不用。`og:image`/`twitter:image` 的社群分享預覽圖會優先用 `heroPhotoId` 對應的照片，沒有設定時退回 `heroStandalonePhotoId`，兩者都沒有才用站台預設圖——想讓這篇文章有專屬的分享預覽圖，至少要設定其中一個。
- `preferredTheme` 選填，二選一：`dark`／`light`。讀者**第一次**進入這篇文章、且還沒手動切換過日夜模式時，套用這裡指定的模式當預設值——不是強制鎖定，讀者仍可用頁面上既有的切換鈕自由切換，且切換後這個建議值就不會再生效。適合夜景/暗色氛圍主題的文章（例如夜遊九份）指定 `dark`，讓多數讀者一進來就看到配色更搭的版本。
- `palette` 選填，三選一：`paper-warm`（暖紙色，省略時的預設）、`ocean-cool`（海洋藍冷色調）、`night-market`（夜市暖黃夜景調）。CSS 規則在 `web/src/blog/BlogArticle.css` 的 `[data-palette="..."]`。`palette` 跟 `preferredTheme` 是兩個獨立維度——`palette` 決定整體配色基調（暖紙/海洋/夜市），`preferredTheme` 決定明暗模式，兩者可以任意組合。
- `status` 要設成 `"published"` 文章才會被公開頁面讀到；`"draft"` 內容可以不完整。

## 圖片怎麼接進文章

**圖片一律用 `photoId` 引用，不要寫檔名或外部網址。** `photoId` 對應 `uploaded_photos.id`（例如 `upf_8ccaad9837ce`），渲染時前端才會把它展開成當下有效的實際網址（原圖被替換也不會壞連結）。

- 先用 CLI 上傳圖片拿到 `photoId`：`tripace-cli blog-photo upload -file 路徑 -content-type image/jpeg -note "場景描述"` （見 `tripace-cli` skill 的 `blog-photo` 子命令）。
- 上傳後用 `blog-photo list` 查目前有哪些圖片可用，`note` 欄位是之前標注過的場景描述，拿不準哪張圖拍了什麼時，用 `Read` 工具直接開縮圖網址看內容，不要憑檔名或上傳順序亂猜。
- **絕對不要**用舊版的 `file: "IMG_xxxx.webp"` 這種固定檔名欄位——這個欄位已被 `photoId` 取代，渲染端完全不認得 `file`，圖片會顯示不出來（這是赤崁・府城那篇文章實際踩過的坑，6 個 gallery、28 張照片全部因此失效）。

## 區塊種類

### `paragraph` — 文字段落

最基本的區塊，任何文章都可以只用這一種。

```json
{ "id": "p1", "kind": "paragraph", "text": "一般內文文字。" }
```

`variant` 選填，四選一，決定視覺樣式（實際字級/字重/顏色由 CSS 的 `[data-variant="..."]` 決定，不在這裡填具體數值）：

| variant | 用途 |
|---|---|
| （省略） | 一般內文 |
| `heading` | 想把一段文字當小標題/轉折點（不是真正的 `<h2>`，仍是同一篇扁平敘事的一段） |
| `emphasis` | 重點強調句，想讓讀者多停留的關鍵句子 |
| `quote` | 引言樣式，摘錄的話、店家招牌文字 |
| `caption` | 小字說明，輔助性質（價位、營業時間這類細節） |

### `image` — 單圖

```json
{
  "id": "img1",
  "kind": "image",
  "photoId": "upf_xxxxx",
  "alt": "圖片替代文字(無障礙/SEO用,寫實際畫面內容)",
  "caption": "圖說(選填)",
  "width": "column",
  "float": "none",
  "focal": { "x": 0.5, "y": 0.2 },
  "orientation": "portrait"
}
```

- `width` 必填，三選一：`column`（欄寬，預設情境）、`wide`（外擴）、`full`（全寬出血）。
- `float` 必填，三選一：`none`、`left`、`right`（文繞圖方向）——**只在 `width: "column"` 時生效**，`wide`/`full` 時渲染端會忽略這個欄位，但仍要填一個值（通常填 `"none"`）。文繞排只在緊接其後的段落文字夠長（至少約 150 字以上，實際門檻依圖片比例調整）時才有效果——文字量不夠會撐不滿圖片高度、底下留一片空白（實機踩過的坑），這種短文字情境改用下面的 `overlayText`。
- `focal` 選填，`{x, y}` 都是 0~1 相對座標，決定縮圖裁切時優先保留畫面哪個位置。省略時以置中裁切處理。也可以不在這裡填，改用 `PhotoFocalEditor`（`/blog/photos` 頁面的焦點編輯器）幫這張圖設定全域焦點，`BlogArticlePage` 渲染時優先用這裡的 `focal`、查無則退回該圖片的全域焦點。
- `orientation` 選填，二選一：`landscape`（省略時的預設，既有橫式比例 1.4~1.6:1）、`portrait`（直式比例，跟 `PhotoFocalEditor` 裁切框精確一致）。**原圖是手機直拍（高>寬）時要手動標成 `"portrait"`，系統不會自動判斷**——判斷方式：用 `blog-photo list` 查這張圖 `variants[].width`/`height`，`height > width` 就是直式。不標的話直式照片會被橫式 `aspect-ratio` 硬裁，主體經常被切掉一大塊。
- `overlayText` 選填，字串，有設定時整個區塊改走「疊字版面」：圖片當滿版背景、文字疊在圖片底部（深色漸層遮罩+白字置中），**有這個欄位時忽略 `width`/`float`**（不疊加套用，疊字版面是獨立的呈現方式）。適合短句、氛圍感強的收尾照片——不依賴「文字要夠長」這個前提，文繞排配短段落時改用這個。



### `gallery` — 多圖群組

**同一個地點/場景如果有多張合適的照片，要用 `gallery`，不要把它們拆成好幾個獨立的 `image` 區塊。** 一個 `gallery` 建議放 2~4 張，不要無限制塞更多——這是刻意的上限，多圖排列的版面在張數太多時會失控。

```json
{
  "id": "stop_1_m1",
  "kind": "gallery",
  "layout": "grid",
  "caption": "整組圖片共用說明(選填)",
  "items": [
    { "photoId": "upf_xxxxx", "alt": "第一張的替代文字" },
    { "photoId": "upf_yyyyy", "alt": "第二張的替代文字" },
    { "photoId": "upf_zzzzz", "alt": "第三張的替代文字", "focal": { "x": 0.5, "y": 0.3 }, "orientation": "portrait" }
  ]
}
```

- `layout` 必填，三選一：
  - `grid`（預設，多數情境用這個）：第一張大圖+其餘固定 2 欄小圖。
  - `row`：取消大小分層，統一縮小、密集多欄排列——適合照片數量多（約 ≥5 張）的站點，避免版面被拉得很長。
  - `split`：固定 3 張的非對稱拼貼——左側一張直式大圖，右側兩張橫式圖上下堆疊（雜誌常見的拼貼版面）。**`items` 必須剛好 3 張，且順序對應固定位置**：`items[0]` 是左側直式大圖、`items[1]`/`items[2]` 是右側由上到下的兩張橫式圖，不是渲染端自動判斷方向——寫入前自行確保張數與順序正確（渲染端若偵測到張數不是 3 張會退回 `grid` 版面並印 console 警告，但不是鼓勵依賴這個防呆）。
- `items` 每一張各自可以有 `orientation`（同 `image` 的 `orientation`，見上）——**同一個 gallery 常常混合橫直式照片，要逐張標，不是整組共用一個值**。`split` 版面例外：方向由固定位置決定，`orientation` 欄位在這個版面下不影響實際呈現。
- `items` 裡每張圖各自可以有自己的 `caption`/`focal`，跟外層的 `caption`（整組共用說明）是分開的兩回事。

### `stop` — 站點卡片

逐站介紹行程（像兩日遊、散策路線）用的卡片，帶編號圓圈、資訊框、斜體語氣補充句——這整套視覺樣式（編號圓圈顏色、資訊框邊框、斜體引言呈現方式）固定寫在 CSS 裡，**這裡只需要決定資料結構，不需要也無法在內容 JSON 裡調整這些視覺細節**。

```json
{
  "id": "stop_1",
  "kind": "stop",
  "index": "壱",
  "day": 1,
  "category": "前世今生",
  "name": "赤崁樓",
  "desc": "主要介紹段落，這一站在講什麼。",
  "blurb": "語氣補充短句，跟 desc 分開渲染，通常帶一點個人觀察或趣味小提醒。",
  "media": [ /* 跟頂層同一組 image/gallery 區塊，放這一站的照片 */ ],
  "info": [["建議停留", "約 45–60 分鐘"], ["備註", "需購票入場"]],
  "layout": "stacked"
}
```

- `index` 是站序標號（純展示用，例如中文數字「壱/弐/参/肆/伍」），不影響實際排序——排序看 `blocks` 陣列本身的順序。
- `day`、`category`、`blurb`、`info`、`layout` 都選填。`layout` 二選一 `stacked`/`side`，是整張卡片的大版面交替，跟 `media` 裡個別圖片的 `width`/`float` 是兩個獨立的排版維度，不要混淆。
- `media` 陣列**跟這一站有多少張合適照片直接對應**：只有一張合適照片就放一個 `image` 區塊；有兩張以上合適照片就改放一個 `gallery` 區塊（2~4 張），不要勉強只選一張、也不要把好幾張各自拆成獨立的 `image` 塞進 `media` 陣列裡（那樣版面不會變成多圖排列，只會是縱向疊放好幾張單圖）。
- 沒有合適照片的站點，`media` 給空陣列 `[]`，不要省略這個欄位。

### 捲動時間軸（`scroll-timeline-start` / `scroll-timeline-anchor` / `scroll-timeline-end`）

把文章段落包進一個互動式小地圖時間軸用的三種標記，詳細設計意圖見 `web/src/blog/types.ts` 裡 `ScrollTimelineStartBlock` 的完整註解。簡述：

- `scroll-timeline-start`：開始標記，帶 `city`（要查詢的城市，對應後端白名單）、`accentColor`（必填，CSS 變數或色碼字串）、`defaultOpenTheme`/`mapRestrictRadiusKm`（選填）。
- `scroll-timeline-anchor`：單一錨點標記，帶 `thumb`（時間軸圓形縮圖網址）、`theme`/`center`（擇一，決定地圖要對應到哪個主題點或座標）、`label`（選填）。這個標記之後、到下一個 anchor 或 end 之前的所有一般區塊，都算是這個錨點的文案內容。
- `scroll-timeline-end`：結束標記，純邊界，無欄位。

這三種標記之間夾著的 `paragraph`/`image`/`gallery`/`stop` 維持完全扁平，不是巢狀結構——渲染端會在顯示前做一次線性分組。沒有互動時間軸需求的文章完全不需要用到這三種 kind。

## 怎麼決定一個場景該用哪種排版

1. 先確認這個場景（站點/段落）有幾張**內容上合適**的候選照片——用 `blog-photo list` 配合 `note` 欄位或直接開圖看內容，不要只看張數湊數。
2. 0 張：這個站點/段落的 `media` 給空陣列，或乾脆不放圖片區塊，不要硬塞不相關的照片。
3. 1 張：用 `image`：
   - 緊接其後的文字段落夠長（約 150 字以上）且想讓圖片靠一側、文字繞排：`width: "column"` + `float: "left"/"right"`。
   - 文字短（一句話、氛圍感強的收尾句）：`overlayText`，文字疊在圖片上，不受文字長度限制。
   - 單純想要一張比一般內文更有存在感、不需要繞排/疊字的代表照：`width: "wide"`（較寬出血）或 `width: "full"`（滿版出血）。
   - 不特別需要出血/疊字/繞排的一般情境：`width: "column"` + `float: "none"`。
4. 2 張以上（最多放 4 張，多出來的留著當候補，不要硬塞進同一組）：改用 `gallery`：
   - 2~4 張、無特別強調哪一張：`layout: "grid"`（預設）。
   - ≥5 張、想保持版面緊湊：`layout: "row"`。
   - 剛好有 1 張直式 + 2 張橫式、想做雜誌式拼貼：`layout: "split"`（固定 3 張，見上方 `split` 的完整說明）。

## 用 CLI 寫入文章內容

```bash
# 先讀出目前內容(避免覆蓋掉別的欄位,基於這份內容修改後再寫回)
tripace-cli content-page get -slug 文章slug

# 把完整的 content JSON 寫入一個檔案(version/slug/title/blocks 等全部欄位都要有,
# content-page set 是整份覆寫,不是局部合併),再用 -content-file 寫入
tripace-cli content-page set -slug 文章slug -content-file /path/to/content.json

# 確認寫入結果
tripace-cli content-page get -slug 文章slug
```

**`content-page set` 是整份覆寫，不是局部 patch**——修改前一定要先 `get` 出目前內容，在它的基礎上修改要改的部分，再整份寫回去，不要只傳要新增/修改的那一小塊 JSON，否則會把其他區塊一起清空。

寫入前，用 Python/jq 之類的工具檢查一次 JSON 格式正確（尤其是 `gallery.items`/`stop.media` 這種巢狀陣列，手寫容易漏逗號或括號），避免寫入半成品内容。
