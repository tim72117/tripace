import type { IdeaDoc } from '../types'
import { MAINTENANCE_01 } from './maintenance-01'
import { MAINTENANCE_02 } from './maintenance-02'

// 這個群組的所有構想。每個構想一份資料檔(同目錄),在這裡 import 並依
// order 排列。
export const SYSTEM_MAINTENANCE_IDEAS: IdeaDoc[] = [
  MAINTENANCE_01,
  MAINTENANCE_02,
]
