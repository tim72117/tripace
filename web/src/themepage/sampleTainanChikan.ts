// sampleTainanChikan:把 TainanChikanPage.tsx 現有 STOPS 陣列(第 86-245
// 行)轉換成 ThemePageContent 規格的範例資料——用來驗證新規格是否能
// 原樣還原既有這篇文章的排版效果,見 ThemePageDemoPage.tsx 的渲染試做。
//
// 轉換規則:
// - 頂層改成扁平 blocks 陣列(見 types.ts 開頭說明第 1 點)——這篇
//   文章恰好「全部由 stop 區塊組成」,但這是內容本身的選擇,不是
//   schema 強制;換一篇文章可以摻雜 paragraph/image,或完全不用
//   stop。TainanChikanPage 只是示範案例,不代表所有主題頁都要長這樣。
// - 每個 STOPS 項目轉成一個 StopBlock(kind: 'stop'),kind 欄位
//   改名 category(避免跟 Block 聯集本身的 kind 欄位撞名)。
// - 每站 gallery 陣列裡只有 1 張照片的,轉成單一 ImageBlock
//   (kind: 'image', width: 'column', float: 'none')——對應原本
//   `.tainan-chikan-stop-gallery--single` 的單張版面。
// - 每站 gallery 陣列有多張照片的,轉成單一 GalleryBlock
//   (kind: 'gallery', layout: 'grid')——對應原本多張照片的格狀排列,
//   caption 留空(原本是逐張 caption,這裡保留在 items 內,不是群組
//   層級的共用說明)。
// - layout: 'stacked' | 'side' 直接沿用原始欄位值。
// - 完全沒有新增/刪減任何站點或文案內容,純粹是資料形狀轉換。
import type { ThemePageContent } from './types'

export const sampleTainanChikan: ThemePageContent = {
  version: 1,
  slug: 'tainan-chikan',
  title: '赤崁・府城兩日遊\n歷史建築活化・住宿・景點・美食',
  eyebrow: '台南兩日遊 · 老地方的前世今生',
  lede: '這趟在赤崁樓附近走了兩天，發現很多地方以前都不是現在這個樣子：消防塔改成了消防史料館，州廳變成文學館，一間老屋改成了民宿。中間還吃了武廟愛玉、在林百貨採買了一下，晚上去神農街看了燈籠。整理成這篇，給想走同一條路線的人參考。',
  status: 'published',
  blocks: [
    {
      id: 'stop_1', kind: 'stop', index: '壱', day: 1, category: '前世今生', name: '赤崁樓',
      desc: '這裡原本是 1653 年荷蘭人蓋的普羅民遮城，地基是當時的荷式磚造結構。後來清朝人在上面重建了海神廟跟文昌閣，變成現在看到的閩南式閣樓。腳下踩的是荷蘭地基，上面是清代建築，走一圈還滿有意思的。',
      blurb: '兩個完全不同年代的東西疊在一起，逛的時候可以留意一下地基跟上面建築的差別。',
      media: [
        { id: 'stop_1_m1', kind: 'image', file: 'IMG_9812.webp', alt: '赤崁樓紅牆藍簷迴廊', caption: '紅牆藍簷的迴廊，石柱林立，屋簷雕花清晰可見', width: 'column', float: 'none' },
      ],
      info: [['建議停留', '約 45–60 分鐘'], ['備註', '需購票入場，園區內有冷氣展間可稍作休息']],
      layout: 'stacked',
    },
    {
      id: 'stop_2', kind: 'stop', index: '弐', day: 1, category: '前世今生', name: '武廟愛玉',
      desc: '祀典武廟旁邊有一攤手洗愛玉，檸檬味酸酸甜甜的。從赤崁樓走過來剛好，逛完流一身汗，坐下來吃一碗冰涼愛玉很舒服。',
      blurb: '手洗愛玉要把籽洗出膠質才會凝結，看起來簡單其實急不得。',
      media: [
        { id: 'stop_2_m1', kind: 'image', file: 'IMG_9813.webp', alt: '武廟愛玉店面招牌', caption: '店面招牌清楚寫著「武廟愛玉」，攤位擺著手作商品', width: 'column', float: 'none' },
      ],
      info: [['位置', '祀典武廟廟埕旁'], ['建議停留', '約 15 分鐘']],
      layout: 'side',
    },
    {
      id: 'stop_3', kind: 'stop', index: '参', day: 1, category: '前世今生', name: '神農街',
      desc: '這裡以前是五條港時期的商業街，現在改成一間間小店，但木造街屋的樣子還留著。晚上整條街掛滿彩色燈籠，老屋被照得暖暖的，難怪大家都愛來拍照。第一天走到這裡，用這個夜景收尾剛剛好，再往前走幾步就是今晚住的天下南隅。',
      blurb: '假日人潮確實不少，想拍空景幾乎不可能，但這種熱鬧感反而才是神農街的味道。',
      media: [
        {
          id: 'stop_3_m1', kind: 'gallery', layout: 'grid',
          items: [
            { file: 'IMG_9817.webp', alt: '神農街夜間燈籠街景', caption: '夜間街景，木造街屋兩側掛滿彩色燈籠' },
            { file: 'IMG_9826.webp', alt: '青花瓷磚老屋外牆', caption: '青花瓷磚裝飾的老屋外牆，門口掛著一排造型燈籠' },
            { file: 'IMG_9823.webp', alt: '轉角店面夜景', caption: '轉角店面夜景，二樓陽台掛著一排燈籠，路人坐在店外休息' },
            { file: 'IMG_9824.webp', alt: '夜間人潮擁擠的街道', caption: '夜間人潮擁擠的街道，兩側店家燈籠與招牌燈火通明' },
          ],
        },
      ],
      info: [['建議停留', '約 40–60 分鐘'], ['備註', '晚上氣氛最佳，週末人潮較多']],
      layout: 'stacked',
    },
    {
      id: 'stop_4', kind: 'stop', index: '肆', day: 1, category: '住宿', name: '天下南隅',
      desc: '這棟樓 1985 年就開了，以前是台南數一數二的高級商務旅館，據說兩任總統都住過，頂樓那間圓頂西餐廳更是不少台南人的兒時回憶。後來歇業荒廢了好一陣子，2020 年開始整修，花了三年重新設計，2023 年底才以「天下南隅」這個新名字重新開張，把 40 年的老屋氣味留著，又加了點現代感。逛完神農街夜景，剛好可以在這過夜。公共區有個開放式廚房，不是房間裡那種小廚具，可以自己煮點東西；大廳整面書牆配上垂掛的藍白布幔，坐在這裡翻書發呆一下午也不會膩。',
      media: [
        {
          id: 'stop_4_m1', kind: 'gallery', layout: 'grid',
          items: [
            { file: 'IMG_9810.webp', alt: '大廳書牆與閱讀區', caption: '大廳書牆與閱讀座位區，天花板垂掛藍白布幔裝置' },
            { file: 'IMG_9809.webp', alt: '公共廚房中島', caption: '公共空間的廚房中島與起居區，冰箱旁立著一把吉他' },
            { file: 'IMG_9811.webp', alt: '大廳圓桌與時鐘', caption: '同一大廳的另一角度，圓桌旁掛著兩座時鐘與圓形畫框' },
          ],
        },
      ],
      info: [['位置', '台南市中西區（步行可達神農街）'], ['特色', '公共廚房、書牆大廳']],
      layout: 'stacked',
    },
    {
      id: 'stop_5', kind: 'stop', index: '伍', day: 2, category: '前世今生', name: '台南市消防史料館',
      desc: '這棟紅磚建築以前是台南合同廳舍消防塔，在地人習慣叫它「火見樓」，現在改成消防史料館，很適合帶小孩來。裡面有古董手拉幫浦車、復古消防吉普車可以看，還有消防服著裝體驗、滑桿體驗區，小朋友可以實際穿上裝備、背上氧氣瓶道具玩消防員負重體驗、摸摸看真的消防車，不是只能隔著玻璃看展示品。',
      blurb: '這站根本是小孩的主場，光是體驗區就能玩上一陣子，大人也看得很開心。',
      media: [
        {
          id: 'stop_5_m1', kind: 'gallery', layout: 'grid',
          items: [
            { file: 'IMG_9833.webp', alt: '消防員模型沿滑桿下滑', caption: '挑高空間裡消防員人形模型正沿著紅色滑桿往下滑' },
            { file: 'IMG_9838.webp', alt: '消防服著裝承重體驗', caption: '「消防服著裝承重體驗」展示區，掛著實際消防衣與安全帽' },
            { file: 'IMG_9839.webp', alt: '兒童體驗區消防員負重體驗', caption: '兒童體驗區，小朋友背著氧氣瓶道具進行消防員負重體驗' },
            { file: 'IMG_9831.webp', alt: '復古消防吉普車', caption: '館內陳列的復古紅色消防吉普車，車身保存完整' },
            { file: 'IMG_9843.webp', alt: '消防塔近景', caption: '消防塔（火見樓）近景，旁邊道路上停著消防車' },
            { file: 'IMG_9828.webp', alt: '建築構造展板', caption: '建築構造展板，標示「火見樓」「旗杆」等建築部位名稱' },
            { file: 'IMG_9864.webp', alt: '消防塔夜景', caption: '夜景，消防塔樓體打上暖黃燈光' },
          ],
        },
      ],
      info: [['建議停留', '約 30–40 分鐘'], ['備註', '免費參觀，設有兒童消防體驗區']],
      layout: 'stacked',
    },
    {
      id: 'stop_6', kind: 'stop', index: '陸', day: 2, category: '前世今生', name: '國立臺灣文學館',
      desc: '這裡以前是台南州廳，老建築的紅磚拱廊整個保留下來，後面又加蓋了一個現代化的圓弧量體，新舊兩種建築語彙就這樣接在一起，走進中庭會先看到老牆、再看到玻璃天花板採光罩，反差感很明顯但不違和。館內有台灣文學發展的常設展，免費參觀，天氣太熱的時候很適合躲進來吹冷氣順便看展。',
      blurb: '紅磚拱廊配現代採光罩這種新舊混搭，比起單純看老建築或單純看新建築，反而更好拍。',
      media: [
        {
          id: 'stop_6_m1', kind: 'gallery', layout: 'grid',
          items: [
            { file: 'IMG_9848.webp', alt: '新舊建築交界的長廊', caption: '長廊空間，紅磚拱門與現代化天花板採光罩並存' },
            { file: 'IMG_9845.webp', alt: '挑高中庭新舊並存', caption: '挑高中庭，紅磚拱廊與現代圓弧量體建築並存' },
            { file: 'IMG_9849.webp', alt: '文學館紅磚立面', caption: '建築外觀，紅磚立面搭配拱窗，門前種植高聳的棕櫚樹' },
            { file: 'IMG_9846.webp', alt: '室內紅磚牆面與閱讀區', caption: '室內紅磚牆面與白色圓柱，旁邊擺著兒童繪本閱讀區' },
            { file: 'IMG_9852.webp', alt: '州廳建築模型', caption: '館內陳列的建築模型，還原原台南州廳的紅磚屋頂全貌' },
          ],
        },
      ],
      info: [['建議停留', '約 30–45 分鐘'], ['備註', '免費參觀，週一休館']],
      layout: 'side',
    },
    {
      id: 'stop_7', kind: 'stop', index: '柒', day: 2, category: '前世今生', name: '林百貨',
      desc: '1932 年開幕，是台南第一間百貨公司，戰後荒廢了幾十年，2014 年才整修重新開幕。轉角立面跟排列整齊的圓窗還是當年的樣子，頂樓還留著神社遺跡。逛完文學館過來剛好，可以上頂樓露台吹吹風、隨意逛逛買點東西，順便吃碗豆花。',
      blurb: '頂樓露台掛滿裝飾燈串，坐在騎樓下休息，看得到旁邊街道，逛到一半需要喘口氣的話很適合。',
      media: [
        {
          id: 'stop_7_m1', kind: 'gallery', layout: 'grid',
          items: [
            { file: 'IMG_9854.webp', alt: '林百貨轉角外觀', caption: '轉角建築外觀，裝飾藝術風格立面、圓窗排列整齊' },
            { file: 'IMG_9855.webp', alt: '頂樓露台裝飾燈串', caption: '頂樓露台，掛滿裝飾燈串，遊客在騎樓下的座位區休憩' },
            { file: 'IMG_9856.webp', alt: '山海豆花', caption: '頂樓山海豆花——粉圓、豆類與碎冰的組合' },
          ],
        },
      ],
      info: [['建議停留', '約 45 分鐘（含頂樓豆花）'], ['備註', '頂樓設有神社遺跡，營業時間詳見官方公告']],
      layout: 'side',
    },
    {
      id: 'stop_8', kind: 'stop', index: '捌', day: 2, category: '前世今生', name: '台南孔廟・孔廟商圈',
      desc: '紅牆大門上掛著「全臺首學」的匾額，1665 年就建了，是全台第一座孔廟。院落裡老樹枝葉很茂密，泮池的水面會倒映出對面建築的屋脊，傍晚去特別安靜。孔廟外圍這一帶是台南人熟悉的商圈，石造牌坊是入口地標，從林百貨走過來不遠，氣氛介於觀光跟日常之間。',
      blurb: '原本想排海安路，但那天週一多數店休，改來孔廟商圈這一帶逛——牌坊進去也有不少小店，氣氛差不多。',
      media: [
        {
          id: 'stop_8_m1', kind: 'gallery', layout: 'grid',
          items: [
            { file: 'IMG_9857.webp', alt: '全臺首學匾額', caption: '紅牆大門，匾額清楚寫著「全臺首學」' },
            { file: 'IMG_9862.webp', alt: '泮池水景', caption: '泮池水景，倒映著對岸紅牆建築的屋脊剪影' },
            { file: 'IMG_9859.webp', alt: '院落景觀', caption: '院落景觀，紅牆廟宇建築掩映在老樹枝葉之間' },
            { file: 'IMG_9860.webp', alt: '傍晚院落與草坪', caption: '傍晚院落，老樹樹冠下可見紅牆廟宇建築群與草坪' },
            { file: 'IMG_9858.webp', alt: '孔廟商圈石造牌坊', caption: '石造牌坊入口，通往傍晚燈火漸亮的商店街道' },
            { file: 'IMG_9863.webp', alt: '石造牌坊近景', caption: '石造牌坊近景，傍晚時分，牌坊後方隱約可見紅牆建築' },
          ],
        },
      ],
      info: [['建議停留', '約 1 小時（含孔廟與周邊商圈）'], ['備註', '孔廟免費參觀，傍晚光線最適合拍照']],
      layout: 'side',
    },
  ],
}
