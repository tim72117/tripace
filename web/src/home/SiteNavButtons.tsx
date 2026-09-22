import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import './SiteNavButtons.css'

// SiteNavButtons:HomePage.tsx/ProductPage.tsx 共用的「固定右上角導覽
// 按鈕列」元件——2026-09 使用者要求「主題介紹頁的按鈕也對齊(首頁)」,
// 幾輪來回手動對齊字級/padding/高度數值之後,使用者明確要求「都共用
// 元件」(而非繼續各自維護一份、每次改動都要手動同步兩邊數值)。這裡
// 把兩個頁面原本各自獨立的按鈕標記(HomePage.tsx 的 .theme-toggle/
// .app-cta、ProductPage.tsx 的 .product-theme-toggle/.product-nav-cta)
// 收斂成一份共用元件+一份共用 CSS(SiteNavButtons.css),兩個頁面都
// import 同一份,樣式/尺寸/邊框/毛玻璃處理只需要改一個地方。
//
// 連定位方式也一併統一(使用者確認「連定位一起改成同一套邏輯」)——
// 原本 ProductPage 是 sticky nav bar 內用 flex 排列,跟 HomePage 的
// fixed 浮動疊層是兩種不同的版面結構。這裡全部改成 HomePage 原本那套
// fixed 疊層模式:品牌標記固定左上角、CTA+日夜切換鈕固定右上角,不隨
// 頁面捲動,兩個頁面视覺行為完全一致。ProductPage 原本的 <nav
// className="product-nav"> sticky bar 整個拿掉,改用這裡的
// <SiteNavBrand>/<SiteNavActions> 兩個 fixed 定位元件。
//
// CSS scope 相容性:兩個頁面各自的根元素(.kyoto-bloom/.product-page)
// 都定義了同一組 --paper/--paper-dim/--ink/--line/--vermilion/
// --vermilion-soft/--card-shadow token(數值逐一比對後完全相同,見
// HomePage.css/ProductPage.css 各自開頭的說明),SiteNavButtons.css
// 直接讀這組 token,不需要另外定義一份、也不需要限定只能掛在某一個
// scope class 下——只要外層有這組 token 定義,這裡的樣式就能正確運作。

export interface SiteNavBrandProps {
  /** 品牌標記的連結目標——HomePage 是 "/"(回到最上方),ProductPage 是 "/" 或不需要連結時可留空。 */
  href?: string
  /** 2026-09 因應城市頁(JiufenPage/KyotoPage/TainanPage/
      TainanChikanPage)也改用這份共用元件而新增——這幾頁品牌標記旁邊
      固定跟著一段純文字頁面標籤(例如「京都 · 清水寺」「九份」「台南・
      安平」),標示目前在哪個城市頁,不是連結。HomePage/ProductPage 都
      不需要這個標籤(省略時只顯示「Tripace」)。 */
  pageLabel?: string
}

/** 固定左上角的品牌標記(純文字「Tripace」,可選加上頁面標籤)。
    2026-09 code review 抓到:原本用普通 <a href> 而非 react-router 的
    <Link>,導致點擊觸發整頁瀏覽器重新載入(SPA 路由被繞過),而非
    client-side 路由切換——這幾個頁面原本(JiufenPage.tsx 等)都是用
    <Link to="/">,搬進共用元件時誤改成普通 <a>,已修正回 <Link>。 */
export function SiteNavBrand({ href = '/', pageLabel }: SiteNavBrandProps) {
  if (!pageLabel) {
    return (
      <Link className="site-nav-brand" to={href}>
        Tripace
      </Link>
    )
  }
  return (
    <div className="site-nav-brand-row">
      <Link className="site-nav-brand" to={href}>Tripace</Link>
      <span className="site-nav-brand-page">{pageLabel}</span>
    </div>
  )
}

export interface SiteNavThemeToggleProps {
  /** 目前是否為深色模式。 */
  dark: boolean
  /** 按下時觸發——呼叫端自行決定切換邏輯(HomePage 用 theme state 三態
      推導、ProductPage 用 dark 布林值直接反轉,兩邊推導方式不同,這裡
      不內建切換邏輯,只負責顯示與觸發回呼)。 */
  onToggle: () => void
}

/** 固定右上角的日夜間切換圓鈕——圖示依「按下後會變成的樣子」顯示
    (目前淺色時顯示月亮,代表按下去會變暗;反之顯示太陽),是動作提示
    而非目前狀態指示,兩個頁面原本就是同一套邏輯,這裡只是收斂成一份。 */
export function SiteNavThemeToggle({ dark, onToggle }: SiteNavThemeToggleProps) {
  return (
    <button
      type="button"
      className="site-nav-theme-toggle"
      onClick={onToggle}
      title={dark ? '切換成日間模式' : '切換成夜間模式'}
      aria-label={dark ? '切換成日間模式' : '切換成夜間模式'}
    >
      {dark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
    </button>
  )
}

export interface SiteNavCtaProps {
  href: string
  children: ReactNode
  /** 疊加在 .site-nav-cta 上的額外 class(例如 HomePage 的
      「功能介紹」需要主色文字/邊框區隔、往左讓開更多空間)——沿用
      CSS class 疊加而非另外複製一份規則的既有慣例(見
      SiteNavButtons.css 的 .site-nav-cta-accent 完整說明)。 */
  variant?: 'default' | 'accent'
  /** 這是頁面上第幾顆固定 CTA(從 1 起算,由左到右的視覺順序)——
      right 偏移只能由呼叫端頁面決定(不同頁面固定按鈕數量不同,見
      SiteNavButtons.css 的 .site-nav-cta 完整說明),用這個 prop 驅動
      對應的 modifier class(.site-nav-cta-slot-2/-3),而非用
      :nth-of-type 之類的位置選擇器——DOM 裡除了 CTA 本身還有
      SiteNavThemeToggle(<button>)、SiteNavBrand(另一個 <a>)穿插在
      同一層,:nth-of-type(N) 算的是「同標籤名的第 N 個元素」,不是
      「第 N 個 SiteNavCta」,容易在增減其他固定元素時悄悄選錯目標;
      明確的 slot prop 不受 DOM 結構影響。省略時走預設 right(單一
      CTA 頁面,例如 ProductPage 只有一顆立即開始,不需要指定)。 */
  slot?: 2 | 3
  onClick?: () => void
  target?: string
  rel?: string
}

/** 固定右上角的文字膠囊 CTA 按鈕(登入/立即開始/功能介紹等)。同
    SiteNavBrand 的說明,改用 <Link> 取代普通 <a>,避免觸發整頁重新
    載入——這幾顆 CTA(登入/立即開始/功能介紹)全部指向站內路由
    (/app、/product 等),沒有指向站外網址的情境,故用 <Link> 取代
    完全安全。 */
export function SiteNavCta({ href, children, variant = 'default', slot, onClick, target, rel }: SiteNavCtaProps) {
  const classNames = ['site-nav-cta']
  if (variant === 'accent') classNames.push('site-nav-cta-accent')
  if (slot) classNames.push(`site-nav-cta-slot-${slot}`)
  return (
    <Link className={classNames.join(' ')} to={href} onClick={onClick} target={target} rel={rel}>
      {children}
    </Link>
  )
}
