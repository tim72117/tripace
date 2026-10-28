// buildLiveHandoverUrl——/ai-plan 播放態 handover 時組出 /ai-plan/live 的網址。
// 保留目前網址的 search(embedded、debugSafeArea 等兩頁都會讀的參數,
// 不然嵌入版/debug 疊圖交接後會丟失),但移除 skipDemo:它只對播放態
// 有意義(LiveContent 不讀),保留會讓推論態誤判。無剩餘參數時不帶問號。
export function buildLiveHandoverUrl(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('skipDemo')
  const qs = params.toString()
  return qs ? `/ai-plan/live?${qs}` : '/ai-plan/live'
}
