// routePathMapSkeletonData.ts:構想一附錄「地圖基底介面骨架雛形」的
// 假資料——瀏覽一份已經排好的主題行程,改用地圖為版面骨架呈現時需要
// 的最小資料子集。欄位命名沿用 RoutePathPlanningPage.tsx 文案稿裡
// RoutePath/RouteThemePoint 的概念(路徑線 + 沿線站點),但這裡的
// 「路徑」只是這份行程走過的路線示意,不是構想七路徑機制要規劃/套用
// 的那種可重複使用的路徑實體。寫死花東縱谷自行車道沿線幾個站點,
// 呼應 RoutePathPlanningPage.tsx 文案裡反覆提到的例子。
//
// photoCase 欄位保留「這個站點的素材質感」區分,但只作為卡片縮圖/
// 標籤的簡化示意,不是這個雛形的重點(重點是地圖畫布/路徑線/縮圖
// 徽章本身):
// - 'google':素材像 Google Places 相片——隨拍質感
// - 'blog':素材像引用自既有部落格文章——摘錄質感
export type ThemePointPhotoCase = 'google' | 'blog'

export interface SkeletonThemePoint {
  id: string
  name: string
  shortLabel: string // 縮圖徽章上顯示的極短標籤(2~4 字)
  // 定位用百分比座標(相對於地圖畫布),不是真實經緯度——雛形只需要
  // 「沿著一條斜切路徑線分佈」的視覺效果。
  xPct: number
  yPct: number
  photoCase: ThemePointPhotoCase
  // 可能性 A 專用欄位
  googlePhotos?: { emoji: string; caption: string }[]
  blurb?: string
  stayMinutes?: number
  // 可能性 B 專用欄位
  blogCoverEmoji?: string
  blogTitle?: string
  blogExcerpt?: string
}

export interface SkeletonRoutePath {
  id: string
  name: string
  desc: string
  suggestedDays: number
  travelModes: string[]
  themePoints: SkeletonThemePoint[]
}

export const ROUTE_PATH_MAP_SKELETON: SkeletonRoutePath = {
  id: 'hualien-valley-bikeway',
  name: '花東縱谷平地森林自行車道',
  desc: '沿著花東縱谷一路向南,途經幾個值得停下來的主題點——適合騎單車或慢慢開車走的路線。',
  suggestedDays: 2,
  travelModes: ['單車', '步行', '開車'],
  themePoints: [
    {
      id: 'dafu-station',
      name: '大富車站',
      shortLabel: '大富',
      xPct: 14,
      yPct: 22,
      photoCase: 'google',
      stayMinutes: 20,
      blurb: '林業小站改建的休憩點,月台跟鐵軌還保留著,很適合騎到這裡喘口氣、拍張照。',
      googlePhotos: [
        { emoji: '🚉', caption: '舊月台' },
        { emoji: '🌳', caption: '站前大樹' },
        { emoji: '🚲', caption: '單車停放區' },
      ],
    },
    {
      id: 'liyu-lake',
      name: '鯉魚潭',
      shortLabel: '鯉魚潭',
      xPct: 30,
      yPct: 40,
      photoCase: 'blog',
      blogCoverEmoji: '🏞️',
      blogTitle: '花東縱谷騎行兩日記',
      blogExcerpt:
        '傍晚騎到鯉魚潭,整片潭水被夕陽染成一片金橘色,環潭步道上幾乎沒什麼人,風裡有股淡淡的水草味——這是整趟騎行裡最想按下暫停鍵多留一會的地方。',
    },
    {
      id: 'chike-niupu',
      name: '池上鄉赤柯山',
      shortLabel: '赤柯山',
      xPct: 52,
      yPct: 58,
      photoCase: 'google',
      stayMinutes: 40,
      blurb: '金針花季時整片山坡染成橙黃色,平時則是安靜的高地展望點,適合中途休息看風景。',
      googlePhotos: [
        { emoji: '🌼', caption: '金針花坡' },
        { emoji: '⛰️', caption: '展望台' },
      ],
    },
    {
      id: 'brown-boulevard',
      name: '伯朗大道',
      shortLabel: '伯朗大道',
      xPct: 68,
      yPct: 72,
      photoCase: 'blog',
      blogCoverEmoji: '🌾',
      blogTitle: '花東縱谷騎行兩日記',
      blogExcerpt:
        '一條沒有電線桿的筆直小路,兩旁是當季的稻田,風一吹整片稻浪跟著晃——很多人是為了這張明信片般的畫面特地繞過來的,我們也不例外。',
    },
    {
      id: 'luye-highland',
      name: '鹿野高台',
      shortLabel: '鹿野高台',
      xPct: 84,
      yPct: 86,
      photoCase: 'google',
      stayMinutes: 50,
      blurb: '熱氣球季的主場地,平時則是能俯瞰整個縱谷平原的制高點,黃昏時分特別值得停留。',
      googlePhotos: [
        { emoji: '🎈', caption: '熱氣球升空' },
        { emoji: '🌄', caption: '縱谷平原遠景' },
        { emoji: '🛵', caption: '滑草場' },
      ],
    },
  ],
}
