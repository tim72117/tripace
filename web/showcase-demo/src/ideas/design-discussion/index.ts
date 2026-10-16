import type { IdeaDoc } from '../types'
import { DESIGN_UX_IDEAS } from './ux'
import { DESIGN_OVERVIEW } from './design-overview'
import { DESIGN_01 } from './design-01'
import { DESIGN_02 } from './design-02'
import { DESIGN_03 } from './design-03'
import { DESIGN_04 } from './design-04'
import { DESIGN_05 } from './design-05'
import { DESIGN_06 } from './design-06'
import { DESIGN_07 } from './design-07'
import { DESIGN_08 } from './design-08'
import { DESIGN_09 } from './design-09'
import { DESIGN_10 } from './design-10'
import { DESIGN_11 } from './design-11'
import { DESIGN_12 } from './design-12'
import { DESIGN_13 } from './design-13'
import { DESIGN_14 } from './design-14'
import { DESIGN_15 } from './design-15'

// 這個群組的所有構想。每個構想一份資料檔(同目錄),在這裡 import 並依
// order 排列;行程 UX 設計文件的頁面在 ./ux 底下,由那邊的 index 匯出。
export const DESIGN_DISCUSSION_IDEAS: IdeaDoc[] = [
  DESIGN_OVERVIEW,
  DESIGN_01,
  DESIGN_02,
  DESIGN_03,
  DESIGN_04,
  DESIGN_05,
  DESIGN_06,
  DESIGN_07,
  DESIGN_08,
  DESIGN_09,
  DESIGN_10,
  DESIGN_11,
  DESIGN_12,
  DESIGN_13,
  DESIGN_14,
  DESIGN_15,
  ...DESIGN_UX_IDEAS,
]
