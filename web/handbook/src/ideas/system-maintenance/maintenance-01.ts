import type { IdeaDoc } from '../types'

export const MAINTENANCE_01: IdeaDoc = {
  id: 'maintenance-01',
  group: 'system-maintenance',
  order: 1,
  title: '景點同步:選定欄位覆蓋(place_id 等)',
  summary: '景點同步(attraction sync)對已存在的景點只覆蓋固定的 7 個欄位,place_id 與 category 不會被覆蓋;記錄現況、碰到的情境與可能的做法,待之後設計。',
  sections: [
    {
      heading: '文件定位',
      paragraphs: [
        '記錄時間:2026-10-27。這是構想草稿,尚未決定做法、也沒有動程式——先把現況、碰到的情境與待決定事項寫下來,晚點再回來設計。',
      ],
    },
    {
      heading: '現況:同步會做什麼',
      paragraphs: [
        '`tripace-cli attraction sync -direction push|pull` 以「來源方為準」單向對齊目的方:只在來源方的新增、兩邊都有但內容不同的用來源方覆蓋、只在目的方的預設保留(加 `-allow-delete` 才刪)。預設是預覽(dry-run),加 `-apply` 才寫入。',
      ],
      table: {
        headers: ['情境', '寫入哪些欄位'],
        rows: [
          ['新增(目的方沒有這筆)', '全部欄位,包含 place_id、category'],
          ['更新(兩邊都有、內容不同)', '名稱、城市、座標、等級、主題點旗標、半徑、介紹,共 7 個'],
          ['比對是否「內容不同」', '同樣只看上面 7 個欄位(加上同名的比對清單),place_id、category 不在其中'],
        ],
      },
      note: '更新路徑刻意不寫 place_id:比對清單沒有這個欄位,單獨覆蓋會造成「寫入了但預覽報告看不到差異」。程式註解有明確記載這是目前的取捨(store 層 UpdateAttractionFields 與同步套件 attractionsync 的 compareFieldSpecs)。',
    },
    {
      heading: '碰到的情境',
      bullets: [
        '在本機替正式站「已經有的」兩筆景點(素帖山雙龍寺、清邁夜間動物園)補了 place_id,同時重寫了介紹;推送預覽顯示 6 筆更新,但寫入後正式站這兩筆仍沒有 place_id,介紹則更新了。',
        '同步的參數只有方向、`-apply`、`-allow-delete`、`-retry`,沒有任何選欄位或篩選景點的旗標。',
        '目前補救只能對正式站用單筆指令(`attraction set-place-id`、`attraction update -field`、`attraction set-theme`)逐筆處理。',
      ],
    },
    {
      heading: '可能的做法',
      table: {
        headers: ['做法', '內容', '優點', '風險與代價'],
        rows: [
          [
            'A. 把 place_id、category 加進比對與更新',
            '改 compareFieldSpecs 與 UpdateAttractionFields,預覽報告也會顯示這兩個欄位的差異',
            '改動小;之後新增欄位同樣只需要改一處',
            '全面生效,無法只覆蓋其中一個欄位;空值與非空值互相覆蓋的語意要先定(例如本機沒有、正式站有,是否要清掉)',
          ],
          [
            'B. 新增選定欄位旗標(例如 `-fields place_id,category`)',
            '同步請求帶欄位清單;比對與更新只處理清單內的欄位,其餘維持現狀',
            '一次同步可只覆蓋需要的欄位;預覽報告只顯示選定欄位的差異',
            '要改 CLI、請求格式、後端兩端(push 與 pull 的決策方不同)、測試與設計文件',
          ],
          [
            'C. 另做「補欄位」的批次指令',
            '例如依景點 id 清單,把指定欄位從一側寫到另一側,不經過三層比對',
            '不影響既有同步的行為',
            '多一套機制,維護成本高;比對與預覽的好處用不上',
          ],
        ],
      },
    },
    {
      heading: '待決定的問題',
      bullets: [
        '「空值」要不要覆蓋:來源方是空、目的方有值時,是保留、還是清掉?',
        '選定欄位之外的「內容不同」要不要仍然覆蓋(目前是全部覆蓋,選欄位後語意要重新定)。',
        '是否要把 `updated_at` 也納入考量:三層比對的第零層靠最新一筆 UpdatedAt 判斷是否需要同步,只改 place_id 時會不會被誤判為「不需要同步」。',
        '`photo_assets`(照片)不在同步範圍內,補了 place_id 之後正式站照片要另外補,這個缺口要不要一起處理。',
      ],
    },
    {
      heading: '操作上要注意的地方(這次踩過)',
      bullets: [
        '`tripace-cli` 沒帶 `-api` 時預設打的是正式站(`https://tripace.io`),不是本機;操作本機要明確帶 `-api http://localhost:8080`。',
        '同步授權(sync-setup)是存在「執行同步的那台 server」上:對本機同步要對本機執行 `sync-setup`(帶 `-api http://localhost:8080`),對正式站執行只會把授權存到正式站自己身上,沒有用。',
        '同步只搬景點表;行程(itinerary_pages)沒有同步機制,要用 `itinerary-page add` 逐份建立;景點的 place_id 補圖(photo_assets)也要另外跑。',
      ],
    },
  ],
  verdict: '尚未決定。傾向先用單筆指令補少量資料,等這類需求變多再評估 B(選定欄位旗標);A 簡單但不能控制範圍。',
  tags: ['景點', '同步', 'CLI', '維運'],
  source: ['server/internal/attractionsync/diff.go', 'server/internal/store/attractions.go', 'docs/attraction-sync-design.md'],
}
