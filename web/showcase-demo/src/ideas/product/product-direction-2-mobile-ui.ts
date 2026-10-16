import type { IdeaDoc } from '../types'

export const PRODUCT_DIRECTION_2: IdeaDoc = {
  id: 'product-direction-2-mobile-ui',
  group: 'product',
  order: 11,
  title: '構想二：手機版介面優化',
  summary: '處理按鈕大小、bottom sheet 拉動滑動問題與相似元件統一;從單手使用者、戶外使用者與工程團隊三種角度延伸,並建議抽出共用的 BottomSheet/Popover 元件。',
  sections: [
    {
      heading: '核心問題',
      paragraphs: ['按鈕大小、bottom sheet 拉動滑動問題、相似元件統一。'],
    },
    {
      heading: '單手持機、通勤途中規劃行程的使用者',
      paragraphs: ['這類使用者最在意「按鈕好不好按」——大拇指熱區、按鈕間距、誤觸機率。'],
      bullets: [
        '延伸做法:全面盤點手機版按鈕的最小熱區是否達到 44×44px(iOS HIG 建議值)。',
        '特別檢查最近新增的「拖拉圓點」(目前桌面版 12px 圓點配合 `::before` 擴大熱區,手機版是否也套用同樣邏輯需要確認)跟交通方式選單按鈕在小螢幕下的可點擊性。',
      ],
    },
    {
      heading: '正在戶外走動、邊走邊查看行程的使用者',
      paragraphs: ['這類使用者會頻繁打開/收合 bottom sheet 查看下一站,拉動手感的流暢度直接影響這個核心動作的體驗。'],
      bullets: [
        '延伸做法:統一手勢回饋曲線(例如拉到一半放開該往哪個方向回彈的判斷邏輯),加入拉動時的輕微觸覺回饋(若平台支援 Haptic API)。',
        '確認 bottom sheet 內部若本身可捲動(長清單),跟「拉 sheet 本身高度」這兩種手勢的判斷邊界是否夠清楚,不會互相搶走手勢。',
      ],
    },
    {
      heading: '開發/維護這個產品的工程團隊角度(相似元件統一)',
      paragraphs: ['這類「使用者」在意的是長期可維護性:散落各處、各自微調過的 bottom sheet/dropdown 實作,日後改一個地方要記得改好幾處。'],
      bullets: [
        '延伸做法:盤點目前專案裡所有 bottom sheet 類元件(`GeoOutlinePhoneView.tsx` 等)與下拉選單類元件(交通方式選單、對話氣泡選單等),抽出一個共用的 `BottomSheet`/`Popover` 基礎元件,統一手勢邏輯、動畫時長、z-index 階層規則,各自的呼叫端只傳內容進去。',
        '這也直接解決「滑動問題」——與其每個 sheet 各自修一次手感,不如修好一份共用邏輯讓全部受益。',
      ],
    },
    {
      heading: '延伸方案',
      bullets: [
        '元件庫文件化:統一元件後,順手整理一份內部的「手勢型元件使用規範」(bottom sheet 該怎麼用、popover 該怎麼用、什麼情況該用哪一種),避免未來又長出第三種、第四種各自獨立的實作。',
        '可及性一併補齊:Fable review 已經指出多處缺少 `:focus-visible`、鍵盤導航、Esc 關閉——統一元件的時機正好一併把這些無障礙基礎補進共用元件,一次性解決所有呼叫端的問題,而不是逐一補丁。',
      ],
    },
  ],
  tags: ['手機版', '元件統一', '可及性'],
  source: ['docs/brainstorm/2026-10-product-direction-brainstorm.md'],
}
