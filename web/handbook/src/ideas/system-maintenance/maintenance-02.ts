import type { IdeaDoc } from '../types'

export const MAINTENANCE_02: IdeaDoc = {
  id: 'maintenance-02',
  group: 'system-maintenance',
  order: 2,
  scale: 'small',
  title: '感興趣點改用 searchResultLayer 繪製',
  summary: '把「感興趣點」畫到地圖上,評估直接複用既有的 searchResultLayer 圖層;記錄目前相關的兩條既有程式碼脈絡與資料形狀落差,待之後設計。',
  sections: [
    {
      heading: '文件定位',
      paragraphs: [
        '記錄時間:2026-10-28。這是構想草稿,尚未決定做法、也沒有動程式——先把現況盤點清楚,晚點再回來設計。',
      ],
    },
    {
      heading: '現況:「感興趣點」目前分散在兩條不相交的既有脈絡',
      paragraphs: [
        '專案裡沒有單一統一的「感興趣點」型別或圖層,容易被名稱混淆,先分清楚:',
      ],
      table: {
        headers: ['脈絡', '資料形狀', '目前的呈現方式'],
        rows: [
          [
            'AI 對話的候選景點卡片',
            'AskPageCandidate(planning/conversation/asktools.ts):只有 placeId,name/summary 選填,沒有座標',
            'AskPage.tsx 的 CandidatesPanel——對話面板裡可複選的照片卡片列表,不畫在地圖上,跟 PlanMap/searchResultLayer 完全不相交',
          ],
          [
            '候選籃(candidate basket)',
            'GeoCandidate(planning/place/candidateHelpers.ts):hotel/attraction/place/entry 四種來源統一後的形狀,已有座標',
            '不是獨立圖層,而是 candidateKeys 這個 Set 一路傳給 searchResultLayer.ts、attractionGlowLayer.ts,改變既有 marker 的樣式(是否標示「已加入候選」),不會多畫新 marker',
          ],
        ],
      },
      note: 'searchResultLayer.ts 畫的是 GeoSearchResult[](飯店/地點/定位結果三種 kind,一筆一顆 marker),candidateKeys 只是切換既有 marker 的外觀——目前沒有任何程式碼把 AskPageCandidate 轉換成可以餵給這個圖層的形狀。',
    },
    {
      heading: '現有繪製層生態系(web/src/planning/map/draw/layers/)',
      bullets: [
        'attractionGlowLayer——景點光暈點(含候選籃/選中狀態疊加)',
        'currentLocationLayer——使用者目前位置',
        'planStopLayer——行程站點',
        'routeLineLayer(搭配 routeArc/routeStyle)——路線連線',
        'searchResultLayer——搜尋結果標記(飯店/地點/定位結果)',
        'transitHoverLineLayer——交通方式 hover 時的連線預覽',
        'tripEntryLayer——行程已排入項目的固定點位(不吃 candidateKeys,因為已有自己的「已排入」狀態)',
      ],
    },
    {
      heading: '待決定的問題',
      bullets: [
        '「感興趣點」的資料來源要接哪一條:AI 對話選出的 AskPageCandidate(只有 placeId,需要額外查座標才能上地圖),還是使用者在地圖上手動加入候選籃的 GeoCandidate(已有座標)?這決定了要不要複用 GeoSearchResult 形狀直接餵給 searchResultLayer,還是需要新增專屬 kind 或新圖層。',
        '若要複用 searchResultLayer:是新增一種 GeoSearchResult.kind,還是在既有三種(hotel/place/geocode)之外另開一條轉換路徑?',
        '若 AskPageCandidate 只有 placeId,接上這個圖層之前需要先查到座標——這一步要在哪一層做(對話工具回傳時、還是地圖端收到候選清單後)?',
      ],
    },
  ],
  verdict: '尚未決定。需要先確認感興趣點的資料來源(AI 對話候選 vs 候選籃),才能評估複用 searchResultLayer 的具體做法。',
  tags: ['地圖', '繪製層', '感興趣點', 'searchResultLayer'],
}
