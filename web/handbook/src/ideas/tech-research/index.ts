import type { IdeaDoc } from '../types'
import { WOC_ARCHITECTURE } from './woc-architecture'
import { WOC_RENDERING } from './woc-rendering'
import { WOC_MODELS } from './woc-models'

// 這個群組的所有研究文件。每篇一份資料檔(同目錄),在這裡 import 並依
// order 排列。
export const TECH_RESEARCH_IDEAS: IdeaDoc[] = [
  WOC_ARCHITECTURE,
  WOC_RENDERING,
  WOC_MODELS,
]
