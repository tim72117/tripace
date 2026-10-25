// 城市主題頁(JiufenPage/KyotoPage/TainanPage)共用的型別。

// PhotoSize——照片原始寬高(px),給 <img width/height> 讓瀏覽器在圖片載入前就依比例
// 預留高度,避免載入後撐開版面。三個城市頁原本各寫一份(九份由 as const 推斷成字面值
// tuple、京都與台南各自手寫 [number, number]),統一成這一份;readonly 讓 as const
// 的資料也能直接符合。
export type PhotoSize = readonly [width: number, height: number]
