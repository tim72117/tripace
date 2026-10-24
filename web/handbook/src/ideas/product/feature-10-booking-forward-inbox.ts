import type { IdeaDoc } from '../types'

export const FEATURE_10: IdeaDoc = {
  id: 'product-feature-10-booking-forward-inbox',
  group: 'product',
  order: 49,
  title: '功能構想 10:訂單轉寄收件匣',
  summary: '每個行程有專屬 email,把訂房/機票/門票確認信轉寄過去,LLM 自動解析成時間軸項目(含訂位代號、地址、QR code);規劃與訂單合在同一條時間軸。雙視角命中。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['每個行程有專屬 email(如 trip-abc@tripace.app),把訂房/機票/門票確認信轉寄過去,自動解析成時間軸項目,含訂位代號、地址、QR code。'],
    },
    {
      heading: '取代的繁瑣流程',
      paragraphs: ['出發前翻十個網站與信箱把代號地址複製到備忘錄,機場排隊時狂滑信箱找 QR code。'],
    },
    {
      heading: '為什麼吸引人',
      paragraphs: ['這是 TripIt 唯一的護城河,但 TripIt 只能排訂單不能規劃;「規劃 + 訂單」在同一條時間軸,使用者沒有理由開兩個 app。'],
    },
    {
      heading: 'AI 角色',
      paragraphs: ['核心——各家確認信格式與語言都不同,LLM 解析非結構化 email 正是強項,規則式 parser 做不到。'],
    },
    {
      heading: '可行性',
      paragraphs: ['inbound mail(SES/Mailgun)成熟、LLM 抽取準確率高;轉寄制比授權讀整個 Gmail 輕量。'],
      note: '難點在 PDF 附件與隱私。',
    },
  ],
  tags: ['功能腦力激盪', 'email 解析', 'TripIt', '雙視角命中'],
  source: ['docs/feature-brainstorm.md'],
}
