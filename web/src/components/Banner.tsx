import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './Banner.module.css'

// Banner:「錯誤/提示訊息該用哪種底色/邊框/字級呈現,以及訊息為空時要
// 整塊不渲染」這組行為的唯一共用實作——重構前,base-ui.css 的全域字串
// class .banner 被 4 處呼叫端各自用 className="banner" 重複引用,其中
// AppCommon.tsx 的 ErrorBanner 與 PublicViewScreen.tsx 還各自重複貼了一份
// 幾乎一模一樣的「msg 為 falsy 時回傳 null,否則外面包一個 AlertCircle
// icon」邏輯與 inline style(marginRight/verticalAlign),PaceChart.tsx/
// Timeline.tsx 則是呼叫端自己用 `{err && <div className="banner">...}`
// 判斷、且不帶 icon——同一個「錯誤橫幅」的概念,實際上分裂成兩種手寫
// 樣板,現在收斂成一個元件、一個 icon prop 決定要不要帶圖示。
//
// API 設計:message 為 falsy(null/undefined/空字串)時整個元件回傳 null、
// 不渲染任何 DOM——比照原本 AppCommon.tsx ErrorBanner 已經在用的模式
// (`if (!msg) return null`),讓呼叫端不需要自己在 JSX 裡寫
// `{err && <Banner .../>}` 這種條件渲染樣板;呼叫端直接
// `<Banner message={err} />` 即可,err 為 null 時自然什麼都不畫。
// 沒有採用「保留 {error && <Banner>{error}</Banner>} 由呼叫端自己判斷」
// 這個替代方案的理由:那個寫法本身就是這次要收斂掉的重複之一(4 處呼叫端
// 各自寫一次同樣的條件判斷),把判斷收進元件裡才是真正單一真理來源。
export interface BannerProps {
  // message:訊息內容。刻意叫 message 而非沿用 AppCommon.tsx 舊版的
  // msg——這裡是新的共用元件,不需要跟隨舊命名,message 對外部呼叫端
  // (非本來就熟悉 msg 這個縮寫的人)更明確。
  message: ReactNode | null | undefined | false
  // icon:是否在訊息前面帶 AlertCircle 圖示——AppCommon.tsx 的
  // ErrorBanner/PublicViewScreen.tsx 原本就帶圖示,PaceChart.tsx/
  // Timeline.tsx 原本不帶,兩種既有樣式都要保留,不能為了統一而讓其中一種
  // 呼叫端的視覺跟著改變。預設 false(不帶圖示)——多數呼叫端(2/4)是
  // 不帶圖示的版本。
  icon?: boolean
  className?: string
}

export function Banner({ message, icon, className }: BannerProps) {
  if (!message) return null
  return (
    <div className={className ? `${styles.banner} ${className}` : styles.banner}>
      {icon && <AlertCircle size={14} strokeWidth={2} className={styles.icon} />}
      {message}
    </div>
  )
}
