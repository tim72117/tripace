import type { IdeaDoc } from '../types'
import { AUDIT_GOOGLE_CACHE_COVERAGE } from './google-cache-coverage'

// 稽核報告分類。新增稽核文件:在這個資料夾加一個檔案、匯出一筆 IdeaDoc
// (group 填 'audit'、不填 source,頁面本身就是原始文件),再加到下面的陣列。
export const AUDIT_IDEAS: IdeaDoc[] = [AUDIT_GOOGLE_CACHE_COVERAGE]
