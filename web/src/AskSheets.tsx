import { useState } from 'react'

// AskUserSheet:agent 呼叫 ask_user 時,前端依 askType 開啟對應輸入 UI 的底部彈出面板。
// 目前支援 askType='date'(日期選擇器);使用者選定後把值透過 onSubmit 送回(當成新訊息)。
export function AskUserSheet({
  askType,
  prompt,
  onSubmit,
  onCancel,
}: {
  askType: string
  prompt: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <div className="ask-user-backdrop" onClick={onCancel}>
      <div className="ask-user-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ask-user-prompt">{prompt || '請補充資訊'}</div>
        {askType === 'date' ? (
          <input
            className="ask-user-date"
            type="date"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <div className="ask-user-unsupported">不支援的輸入類型：{askType}</div>
        )}
        <div className="ask-user-actions">
          <button className="btn-secondary" onClick={onCancel}>取消</button>
          <button
            className="btn-primary"
            disabled={!value}
            onClick={() => value && onSubmit(value)}
          >
            確定
          </button>
        </div>
      </div>
    </div>
  )
}

// ask_choice 工具的一個選項:主標題(必填)+ 一行描述(可選),與後端
// server/internal/wanttools/ask_choice.go 的 AskChoiceOption 對齊。
export type AskChoiceOption = { title: string; description?: string }

// AskChoiceSheet:agent 呼叫 ask_choice 時,前端開啟的選單底部彈出面板
// (獨立於 AskUserSheet 的全新元件,職責不同:單選、選項數不限、每項有主標題+描述)。
// 視覺與互動模式比照 AskUserSheet(複用 .ask-user-backdrop/.ask-user-sheet):
// 點背景或「取消」鈕關閉且不送出任何值;點某個選項則把該選項的 title 透過
// onSubmit 送回(當成新訊息,不含 description)。
export function AskChoiceSheet({
  prompt,
  options,
  onSubmit,
  onCancel,
}: {
  prompt: string
  options: AskChoiceOption[]
  onSubmit: (title: string) => void
  onCancel: () => void
}) {
  return (
    <div className="ask-user-backdrop" onClick={onCancel}>
      <div className="ask-user-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ask-user-prompt">{prompt || '請選擇一個選項'}</div>
        <div className="ask-choice-list">
          {options.map((opt, i) => (
            <button
              key={i}
              className="ask-choice-option"
              onClick={() => onSubmit(opt.title)}
            >
              <span className="ask-choice-option-title">{opt.title}</span>
              {opt.description && (
                <span className="ask-choice-option-desc">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ask-user-actions">
          <button className="btn-secondary" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}
