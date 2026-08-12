import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

// 慢動作除錯用設定——slowMo 讓 Playwright 每個底層動作(滑鼠移動/點擊/
// 按下放開)之間插入延遲,方便肉眼觀察每一步驟實際發生了什麼。不是給
// 一般 CI/日常測試用,故獨立成這份設定檔,不動 playwright.config.ts 本身
// 的預設值。
export default defineConfig({
  ...baseConfig,
  timeout: 300_000,
  use: {
    ...baseConfig.use,
    launchOptions: { slowMo: 1500 },
  },
})
