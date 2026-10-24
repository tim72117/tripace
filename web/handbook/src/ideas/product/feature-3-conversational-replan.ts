import type { IdeaDoc } from '../types'

export const FEATURE_3: IdeaDoc = {
  id: 'product-feature-3-conversational-replan',
  group: 'product',
  order: 42,
  title: '功能構想 3:對話式重排(模糊指令 + 連鎖順延 + diff 預覽)',
  summary: '一句「第二天下午太趕,幫我鬆一點」讓 AI 重排整段,移動或刪除一個點時自動順延補位;所有批次改動先 diff 預覽、確認後套用並可一鍵還原。雙視角命中。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['一句「第二天下午太趕,幫我鬆一點」讓 AI 重排整段;刪掉或移動一個點時自動把後續順延補位。所有批次改動先以 diff 預覽(移了什麼、砍了什麼、為什麼),確認後一鍵套用,並可一鍵還原。'],
    },
    {
      heading: '取代的繁瑣流程',
      paragraphs: ['臨時取消一個點後,手動逐一改後面五個項目的時間、重查每段交通,改到一半放棄導致整天亂掉。'],
    },
    {
      heading: '為什麼非 AI 不可',
      paragraphs: ['「太趕」「鬆一點」是主觀約束,傳統 UI 沒有這種輸入欄位;LLM 把模糊意圖翻譯成一組具體編輯操作,人只負責審核。'],
    },
    {
      heading: '可行性',
      paragraphs: [
        '既有 LLM 工具呼叫管線直接可用;關鍵新增是 diff 預覽 + undo——沒有它,AI 一次改動過大就會信任崩潰。',
        '這也是後續所有 AI 批次操作的信任基礎建設。',
      ],
    },
  ],
  tags: ['功能腦力激盪', '重排', 'diff 預覽', 'undo', '雙視角命中'],
  source: ['docs/feature-brainstorm.md'],
}
