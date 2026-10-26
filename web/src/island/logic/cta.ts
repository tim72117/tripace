// cta.ts——「用 Tripace 排我的九份」按鈕的連結組裝(純函式)。
//
// 原型只連到 /ai-plan 並帶上來源參數(from=island、article=文章 slug、stops=站名清單)。
// 注意:目前 /ai-plan 只讀 embedded/skipDemo/debugSafeArea 三個參數,不會讀這裡帶的參數,
// 所以現在只是把人帶過去;之後要把站點當起點,需要 /ai-plan 端另外實作接收。
export function buildCtaUrl(base: string, p: { slug: string; stopNames: ReadonlyArray<string> }): string {
  const u = new URL('/ai-plan', base)
  u.searchParams.set('from', 'island')
  u.searchParams.set('article', p.slug)
  if (p.stopNames.length) u.searchParams.set('stops', p.stopNames.join('|'))
  return u.toString()
}
