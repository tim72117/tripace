import { Link } from 'react-router-dom'
import styles from './RoutePathPlanningPage.module.css'

// RoutePathPlanningPage:構想七(路徑機制——AI 參考旅遊路徑安排行程)
// 雛形——對應 構想頁 /ideas/research-route-path-01 起的構想筆記,
// 兩份內容同步,這裡是視覺化版本。這份純粹是構想文案頁,不是可運作的
// 功能雛形(沒有假資料互動、沒有地圖),比照 ShowcaseDemoIndex 裡構想七
// 項目的 status: 'draft' 定位——寫法風格對齊 PlanningModesPage.tsx(構想
// 三)的既有組織慣例:page/inner/back/heading/subheading 骨架 + 區塊式
// 內容,但這裡的內容更偏長篇文案,改用章節(section)堆疊而非並排面板。
//
// 內容對齊已確認的既有基礎,不是憑空發想:
// - 既有「路徑」功能(VITE_FEATURE_PACE):web/src/pace/PaceRouteMap.tsx
//   (地圖畫 Polyline + 途經點 marker,真的在跑路徑規劃)+ 後端
//   server/internal/api/pace_route.go 的 computeRouteByWaypoints()
//   (已串接 Google Routes API)+ entry_geocode.go 的
//   computeRouteForEntries()(依行程 entry 座標算路徑的核心邏輯)。
// - 主題點/子景點資料結構(intro 分支 planTimeline.ts 的 PlanThemeChild
//   /PlanNodeData.children)——路徑底下掛多個主題點的概念延伸自這裡。
// - 前端介面層的「照片呈現」兩種可能性,是使用者明確要求用 Fable 風格
//   (視覺化、有畫面感)發想的重點小節,見下方 PhotoVision 區塊。
export function RoutePathPlanningPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>構想七：路徑機制</h1>
        <p className={styles.subheading}>
          存放特定旅遊路徑，讓 AI 排行程時能參考路線沿途安排站點——不是每次都從零散的景點清單現場拼湊順序，
          而是先有一條「已經被驗證走得通」的路徑骨架，AI 只需要決定在這條骨架上停哪幾站、停多久。
        </p>

        {/* 核心問題 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>核心問題</h2>
          <p className={styles.p}>
            AI 現在排行程時，是把一堆單獨的景點（entry）丟進時間軸，靠座標距離跟營業時間湊出合理順序。
            這種做法對「景點彼此沒有強烈地理關聯」的情境沒問題，但對某些旅遊型態——沿著一條溪流、一段海岸線、
            一條老街、一條花東縱谷的脈絡——這種「順著走」本身就是體驗的一部分，單點湊順序湊不出這種感覺。
          </p>
          <p className={styles.p}>
            現有的「路徑」功能（<code>PaceRouteMap.tsx</code> + <code>pace_route.go</code>）已經證明
            「給一批有座標的點，串 Google Routes API 算出一條沿真實路網走的路徑」這件事能做。但它目前只是
            配速表的輔助視覺（畫出使用者已經排好的行程點之間怎麼走），路徑本身不是一個可以被<strong>預先定義、
            命名、重複使用</strong>的實體——這正是構想七要補的缺口：把「路徑」從「行程排完後才算出來的衍生結果」，
            升級成「AI 排行程前就可以參考、甚至直接套用的既有資料」。
          </p>
        </section>

        {/* 不同使用者角度 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>不同使用者角度</h2>

          <div className={styles.angle}>
            <h3 className={styles.angleTitle}>第一次規劃某條知名路線的旅客</h3>
            <p className={styles.p}>
              例如「花東縱谷自行車道」「九份老街到金瓜石」「台南孔廟文化園區周邊」——這類路線本身已經是
              被廣泛認可的「一條路」，旅客想要的不是 AI 幫他從頭發明一條路，而是「照這條大家都走的路，
              幫我排出合理的停靠點與時間」。延伸做法：AI 對話一開始偵測到使用者提及的地點落在某條已登記的
              路徑範圍內，主動提議「要不要參考『花東縱谷自行車道』這條路徑安排？」，而不是從零開始規劃。
            </p>
          </div>

          <div className={styles.angle}>
            <h3 className={styles.angleTitle}>想要「沿途隨興停」而非精確時間表的旅客</h3>
            <p className={styles.p}>
              這類旅客的心理模型更接近「開車/騎車上路，看到喜歡的就停」，而不是逐站打卡。延伸做法：路徑底下
              掛的「主題點」用構想三討論過的 children 概念呈現——整條路徑本身是地圖上一條線，沿線標出幾個
              主題點（不是精確到幾點幾分的時間軸節點），每個主題點底下才是具體子景點，使用者可以選擇展開看
              細節，也可以整段忽略，不強迫逐站規劃。
            </p>
          </div>

          <div className={styles.angle}>
            <h3 className={styles.angleTitle}>內容創作者/部落客（對接構想五）</h3>
            <p className={styles.p}>
              部落客寫過「花東縱谷三天兩夜」這類圖文並茂的路線遊記，這篇文章本身蘊含了「這條路徑該怎麼玩」
              的第一手經驗，比系統自己演算的路徑更有說服力。延伸做法：路徑資料可以反向連結到一篇已發布的
              部落格文章，AI 排行程參考這條路徑時，順勢把文章裡的圖文素材也帶進使用者看到的行程畫面——
              這正是下方「前端介面層構想」要具體描繪的兩種照片呈現方式之一。
            </p>
          </div>
        </section>

        {/* 資料結構草案 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>資料結構草案</h2>
          <p className={styles.p}>
            路徑（<code>RoutePath</code>，暫定名稱）需要能表達「一條具名的路線」，並且能掛多個主題點，
            對齊既有的主題點/子景點概念（<code>PlanThemeChild</code>），而不是另外發明一套平行的資料模型：
          </p>
          <pre className={styles.code}>
{`interface RoutePath {
  id: string
  name: string              // 「花東縱谷自行車道」「九份金瓜石老街線」
  desc?: string             // 這條路徑適合誰、適合什麼心情走
  waypoints: RouteWaypoint[]        // 途經點序列,決定線怎麼畫
  themePoints?: RouteThemePoint[]   // 沿線的主題點(可選,見下方)
  suggestedDays?: number             // 建議天數(走完整條路大致需要幾天)
  travelModes?: ('walk' | 'bike' | 'drive' | 'transit')[]  // 適合的交通方式
  sourceBlogPostId?: string  // 若這條路徑是從某篇部落格文章萃取/連結而來
  // 刻意不存 encodedPolyline——2026-10 使用者明確要求研究 Google Routes
  // API 的存放/使用限制後發現:Routes API 政策頁明文「大多數 Routes
  // API 內容禁止快取,只有 place_id 豁免」,encoded polyline 屬於受限
  // 內容,不像 Place Photo API 那樣有「換存不過期識別碼」的替代解法
  // ——waypoints(使用者自己登記的座標,不是 Google 回傳內容)才是這裡
  // 唯一該持久化的資料,路徑線永遠在使用時依 waypoints 即時重算(見下方
  // 「後端角度」的完整說明)。
}

interface RouteWaypoint {
  lat: number
  lng: number
  label?: string             // 給 Routes API intermediates 用的輔助標籤
}

// RouteThemePoint 直接複用 PlanThemeChild 的欄位子集概念——一條路徑上
// 掛的「主題點」跟時間軸上的主題節點是同一種展示單位,只是容器從「時間
// 軸節點」換成「路徑上的一個定錨點」。
interface RouteThemePoint {
  id: string
  name?: string
  desc?: string
  placeId?: string
  lat?: number
  lng?: number
  googlePhotoUrls?: string[]
  children?: PlanThemeChild[]  // 這個主題點底下還可以再掛多個子景點,
                                 // 完全沿用既有型別,不重新定義
}`}
          </pre>
          <p className={styles.p}>
            關鍵設計決定：<strong>一條路徑底下能掛多個主題點，一個主題點底下又能掛多個子景點</strong>
            ——三層結構（路徑 → 主題點 → 子景點）對應「這條路線 → 沿途幾個值得停的區域 → 每個區域裡具體的景點」
            這個自然的心智模型。AI 排行程時可以選擇在「主題點」這一層粒度安排（整個區域排一個時段），
            也可以下探到「子景點」這一層（區域裡特定幾個點各自安排），彈性留給排程邏輯決定，不是資料結構本身的限制。
          </p>
        </section>

        {/* 後端角度 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>後端角度</h2>
          <p className={styles.p}>
            路徑計算沿用既有的 <code>computeRouteByWaypoints()</code>（<code>pace_route.go</code>）——
            給 <code>RoutePath.waypoints</code> 當 origin/intermediates/destination，一樣打 Google Routes
            API 算出 encoded polyline 與每段 leg 的起訖座標，計算邏輯不需要重新發明，只是輸入來源
            從「使用者行程裡的 entry 座標」換成「路徑自己登記的固定途經點」。
          </p>
          <p className={styles.p}>
            <strong>不持久化路徑計算結果</strong>——Google Maps Platform 服務條款對 Routes API 回傳內容採「預設
            禁止快取」原則，只有 <code>place_id</code> 明文豁免可無限期保存，encoded polyline 不在豁免範圍內
            （這點跟既有 Place Photo API 的快取限制邏輯一致：穩定識別碼可以存，Google 回傳的內容本身不行）。
            因此 <code>encodedPolyline</code> 不會是資料庫欄位——每次使用者瀏覽某條路徑時，才依
            <code>waypoints</code> 即時呼叫 Routes API 重算，可以比照 <code>pace_route.go</code>
            既有的進程內短期快取（同一組 waypoints 短時間內重複請求不必重打 API，但不寫進資料庫長期保存）
            降低重複計費成本，不是違規地把路徑線本身存成一個長期欄位。
          </p>
          <p className={styles.p}>
            路徑資料存放與發布，可以比照部落格 <code>content_pages</code> 那套模式：路徑本身是一種內容型態，
            由內部 CLI 建立/編輯/發布（不透過一般使用者介面寫入），存進資料庫一張 <code>route_paths</code> 表，
            <code>themePoints</code>/<code>children</code> 這類巢狀結構用 JSON 欄位存放（對齊 content_pages
            的 JSON 內容區塊模式，不用把每一層都拆成獨立的關聯表）。CLI 指令大致是
            <code>cli route-path create/update/publish</code> 這個方向，細節（欄位驗證、草稿/發布狀態機）
            留到實際要做的時候再比照 content_pages CLI 的既有慣例展開，這裡先點出「不是全新一套系統，
            是同一套內容發布模式的另一種內容型態」這個方向即可。
          </p>
          <p className={styles.p}>
            AI 排行程時怎麼「參考」路徑：路徑資料本身可以當作 LLM 工具呼叫的一種查詢結果（類似現有的
            <code>attractionTools.ts</code> 查詢機制），例如新增一個 <code>find_route_path</code> 工具，
            依使用者提及的地區/關鍵字找出匹配的已登記路徑，回傳給 LLM 當作排程的參考骨架，而不是要 LLM
            自己憑空想像一條路徑該怎麼走。
          </p>
        </section>

        {/* 前端介面層構想——重點：Fable 風格 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>前端介面層構想：使用者會看到什麼畫面</h2>
          <p className={styles.p}>
            這一節不寫規格條列，試著描繪使用者實際會看到、會點、會停下來多看一眼的畫面。
          </p>

          <div className={styles.scene}>
            <h3 className={styles.sceneTitle}>場景一：AI 提議一條路徑</h3>
            <p className={styles.p}>
              使用者在對話框打了「想去花蓮玩三天，喜歡騎腳踏車」。AI 的回覆不是立刻條列景點，而是先彈出一張
              橫向捲動的「路徑卡」，讓使用者一看就懂——這不是 AI 臨時編的，是一條真實存在、被很多人走過的路，
              他只是在選一條已經鋪好的路，不是從一張空白地圖開始。
            </p>
            <div className={styles.routeCardMock}>
              <div className={styles.routeCardMapMock}>
                <svg viewBox="0 0 200 90" className={styles.routeCardSvg} preserveAspectRatio="none">
                  <path
                    d="M 10 70 C 50 20, 90 85, 130 35 S 185 15, 195 25"
                    className={styles.routeCardLine}
                  />
                  <circle cx="30" cy="58" r="4" className={styles.routeCardDot} />
                  <circle cx="108" cy="55" r="4" className={styles.routeCardDot} />
                  <circle cx="160" cy="24" r="4" className={styles.routeCardDot} />
                </svg>
              </div>
              <div className={styles.routeCardBody}>
                <div className={styles.routeCardText}>
                  花東縱谷平地森林自行車道・建議 2 天・適合單車／步行
                </div>
                <button type="button" className={styles.routeCardCta}>
                  套用這條路徑規劃
                </button>
              </div>
            </div>
          </div>

          <div className={styles.scene}>
            <h3 className={styles.sceneTitle}>場景二：沿途主題點的呈現——地圖為版面骨架</h3>
            <p className={styles.p}>
              套用路徑後，畫面主體換成一張大地圖，路徑線沿著畫面斜切而過像一條緞帶，線上浮著幾個圓形縮圖徽章
              （裁成圓形、帶白色邊框，像 Google 地圖「熱門景點」標記的質感）。地圖是主角，照片是點綴在路徑上
              的「預告」，視線動線是先看到整條路的形狀，再被某個縮圖吸引去點開細看，而不是先看一排文字清單。
            </p>
            <div className={styles.routeMapMock}>
              <svg viewBox="0 0 320 160" className={styles.routeMapSvg} preserveAspectRatio="none">
                <path
                  d="M 5 140 C 70 60, 120 150, 180 70 S 280 20, 315 30"
                  className={styles.routeMapLine}
                />
                <g className={styles.routeMapBadge}>
                  <circle cx="60" cy="108" r="14" />
                </g>
                <g className={styles.routeMapBadge}>
                  <circle cx="152" cy="98" r="14" />
                </g>
                <g className={styles.routeMapBadge}>
                  <circle cx="222" cy="52" r="14" />
                </g>
                <g className={styles.routeMapBadge}>
                  <circle cx="288" cy="28" r="14" />
                </g>
              </svg>
            </div>
          </div>

          <div className={styles.scene}>
            <h3 className={styles.sceneTitle}>照片呈現：兩種可能性</h3>
            <p className={styles.p}>
              點開路徑線上的某個主題點縮圖，畫面會往下展開一張卡片——這張卡片長什麼樣子，取決於這個主題點
              的照片來源是哪一種：
            </p>

            <div className={styles.photoCaseRow}>
              <div className={styles.photoCase}>
                <div className={styles.photoCaseLabel}>可能性 A・Google Places 相片</div>
                <div className={styles.photoMockA}>
                  <div className={styles.photoMockAStrip}>
                    <span className={styles.photoMockThumb} />
                    <span className={styles.photoMockThumb} />
                    <span className={styles.photoMockThumb} />
                    <span className={styles.photoMockThumb} />
                  </div>
                  <div className={styles.photoMockCaption}>來自 Google 地圖使用者相片</div>
                </div>
                <p className={styles.p}>
                  一排可以左右滑動的照片，畫質偏「寫實紀錄」——遊客自己上傳到 Google 的隨拍，正是這種
                  「不完美的真實感」讓使用者覺得這是真的有人去過、拍下來的。配的文案很短，語氣像導覽手冊的
                  簡介。這種呈現適合系統自動從路徑途經點抓出來、沒有人特別為它寫過文章的主題點。
                </p>
              </div>

              <div className={styles.photoCase}>
                <div className={styles.photoCaseLabel}>可能性 B・連結既有部落格文章</div>
                <div className={styles.photoMockB}>
                  <div className={styles.photoMockBHero} />
                  <div className={styles.photoMockBExcerpt}>
                    <span className={styles.photoMockBLine} />
                    <span className={styles.photoMockBLine} />
                    <span className={styles.photoMockBLineShort} />
                  </div>
                </div>
                <p className={styles.p}>
                  一張精心挑選的大圖置頂（部落格文章封面或代表圖），底下接著一段摘錄文字，像在讀一段遊記節錄
                  而不是系統生成的介紹。右上角標籤「摘自：〈花東縱谷騎行兩日記〉」可直接跳轉完整文章，重用
                  文章既有的多圖群組排版。這種呈現適合路徑本身就是從某篇文章萃取而來
                  （對齊 <code>sourceBlogPostId</code>）。
                </p>
              </div>
            </div>

            <p className={styles.p}>
              兩種可能性不是互斥的二選一——同一條路徑上，有文章紀錄的主題點用可能性 B 呈現，沒有文章只有
              Google 資料的主題點用可能性 A 呈現，使用者在同一張地圖上滑動瀏覽時，會自然遇到兩種質感交替
              出現：有的停靠點像導覽手冊的簡介卡，有的停靠點像翻開一頁別人寫的遊記。這種交替本身不是缺陷，
              反而讓整條路徑讀起來有層次——系統補完的資訊跟真人寫過的體驗並存，使用者可以憑直覺分辨「這段
              是有人真心推薦過的」還是「這段是系統幫我查到的基本資訊」。
            </p>
          </div>

          <div className={styles.scene}>
            <h3 className={styles.sceneTitle}>場景三：AI 排程時「借用」路徑的語氣</h3>
            <p className={styles.p}>
              使用者套用路徑後繼續跟 AI 對話：「那在這附近找個地方吃午餐」。AI 的回覆會順勢提到「沿著這條
              路徑，大約在你們第一天行程的中段會經過『大富火車站』附近，那邊有幾間老店」——AI 說話時明確
              知道「使用者現在是沿著這條路徑走」，推薦邏輯錨定在路徑的地理脈絡上，不是憑空丟一個離題的建議。
              這呼應核心問題：路徑不只是畫面上的一條線，也是 AI 回話時隱含的「我們現在正走在哪」的上下文。
            </p>
          </div>
        </section>

        <div className={styles.note}>
          <strong>雛形限制：</strong>
          這份是純構想文案，沒有可運作的假資料互動（不像構想一/三那樣有卡片牆或面板可以點）。
          資料結構草案（<code>RoutePath</code>/<code>RouteThemePoint</code>）尚未真正落地成型別檔案或
          後端 schema；「照片呈現兩種可能性」目前只有文字描繪，尚未做出對應的 UI 元件雛形。這些留待使用者
          篩選這份構想要不要往下推進後，再決定是否值得投入做出真正可互動的雛形（對齊既有雛形頁面如構想一/三
          的程度）。
        </div>
      </div>
    </div>
  )
}
