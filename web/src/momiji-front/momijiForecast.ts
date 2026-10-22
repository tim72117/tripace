// momijiForecast.ts——2026 年紅葉・黃葉見頃預測日(資料檔)。
//
// 來源:日本氣象株式會社「2026年紅葉・黃葉見頃預測(第2回)」,2026-10-01 發表,
// 頁面「2026年主要都市的紅葉・黃葉見頃預測日」兩張表(14 個主要都市)。
//   https://n-kishou.com/corp/news-contents/autumn/
// 預測日的定義(依該頁說明):依氣象廳標本木的觀測基準,「樹木大部分的葉子
// 變成紅(黃)色的第一天」。紅葉對象主要是日本常見的青楓(又稱伊呂波楓),
// 北海道不易生長,札幌改用當地較容易生長的楓樹品種;黃葉對象是銀杏。
// 下一回預測預定在 11 月上旬發表——更新時直接改這份資料,頁面會跟著變
// (模擬的起訖日、各地變色時程都由這裡推導,見 momijiFrontModel.ts)。
//
// 這份檔案只放「事實資料」(都市、座標、預測日、平年日),不放任何推導
// 結果;日期一律是 2026 年的月-日字串 'MM-DD',平年日同樣用 2026 年的
// 日曆對照(只用來顯示「比平年早/晚幾天」)。座標是都市中心的概略位置,
// 內插用,精度不需要更高。

export const FORECAST_SOURCE = {
  publisher: '日本氣象株式會社',
  title: '2026年紅葉・黃葉見頃預測(第2回)',
  announcedOn: '2026-10-01',
  url: 'https://n-kishou.com/corp/news-contents/autumn/',
} as const

export interface SeasonDates {
  peak: string // 預測見頃日 'MM-DD'
  normal: string // 平年見頃日 'MM-DD'
  // deltaDays——來源頁公布的「平年差」(預測日 − 平年日,單位天)。資料檔裡
  // 照抄來源值,測試會用 peak/normal 重新算一次對照,抄錯就會被抓到。
  deltaDays: number
}

export interface CityForecast {
  id: string
  name: string // 都市名(對應來源頁的標示,以繁體字書寫)
  nameZh: string
  lat: number
  lng: number
  momiji: SeasonDates // 紅葉(楓)
  ginkgo: SeasonDates // 黃葉(銀杏)
}

export const CITY_FORECASTS: ReadonlyArray<CityForecast> = [
  { id: 'sapporo', name: '札幌', nameZh: '札幌', lat: 43.0621, lng: 141.3544, momiji: { peak: '11-04', normal: '10-28', deltaDays: 7 }, ginkgo: { peak: '11-03', normal: '11-04', deltaDays: -1 } },
  { id: 'aomori', name: '青森', nameZh: '青森', lat: 40.8246, lng: 140.74, momiji: { peak: '11-13', normal: '11-13', deltaDays: 0 }, ginkgo: { peak: '11-05', normal: '11-02', deltaDays: 3 } },
  { id: 'sendai', name: '仙台', nameZh: '仙台', lat: 38.2682, lng: 140.8694, momiji: { peak: '11-24', normal: '11-21', deltaDays: 3 }, ginkgo: { peak: '11-29', normal: '11-23', deltaDays: 6 } },
  { id: 'tokyo', name: '東京', nameZh: '東京', lat: 35.6895, lng: 139.6917, momiji: { peak: '11-28', normal: '11-28', deltaDays: 0 }, ginkgo: { peak: '11-26', normal: '11-23', deltaDays: 3 } },
  { id: 'kanazawa', name: '金澤', nameZh: '金澤', lat: 36.5613, lng: 136.6562, momiji: { peak: '11-30', normal: '11-24', deltaDays: 6 }, ginkgo: { peak: '11-10', normal: '11-10', deltaDays: 0 } },
  { id: 'nagano', name: '長野', nameZh: '長野', lat: 36.6513, lng: 138.181, momiji: { peak: '11-21', normal: '11-12', deltaDays: 9 }, ginkgo: { peak: '11-14', normal: '11-10', deltaDays: 4 } },
  { id: 'nagoya', name: '名古屋', nameZh: '名古屋', lat: 35.1815, lng: 136.9066, momiji: { peak: '12-02', normal: '11-28', deltaDays: 4 }, ginkgo: { peak: '11-17', normal: '11-18', deltaDays: -1 } },
  { id: 'kyoto', name: '京都', nameZh: '京都', lat: 35.0116, lng: 135.7681, momiji: { peak: '12-11', normal: '12-05', deltaDays: 6 }, ginkgo: { peak: '11-27', normal: '11-24', deltaDays: 3 } },
  { id: 'osaka', name: '大阪', nameZh: '大阪', lat: 34.6937, lng: 135.5023, momiji: { peak: '12-04', normal: '12-01', deltaDays: 3 }, ginkgo: { peak: '11-24', normal: '11-22', deltaDays: 2 } },
  { id: 'wakayama', name: '和歌山', nameZh: '和歌山', lat: 34.226, lng: 135.1675, momiji: { peak: '12-12', normal: '12-06', deltaDays: 6 }, ginkgo: { peak: '11-26', normal: '11-23', deltaDays: 3 } },
  { id: 'hiroshima', name: '廣島', nameZh: '廣島', lat: 34.3853, lng: 132.4553, momiji: { peak: '11-28', normal: '11-22', deltaDays: 6 }, ginkgo: { peak: '11-21', normal: '11-15', deltaDays: 6 } },
  { id: 'kochi', name: '高知', nameZh: '高知', lat: 33.5597, lng: 133.5311, momiji: { peak: '12-09', normal: '12-02', deltaDays: 7 }, ginkgo: { peak: '11-16', normal: '11-15', deltaDays: 1 } },
  { id: 'fukuoka', name: '福岡', nameZh: '福岡', lat: 33.5904, lng: 130.4017, momiji: { peak: '12-07', normal: '12-01', deltaDays: 6 }, ginkgo: { peak: '11-28', normal: '11-20', deltaDays: 8 } },
  { id: 'kagoshima', name: '鹿兒島', nameZh: '鹿兒島', lat: 31.5966, lng: 130.5571, momiji: { peak: '12-10', normal: '12-15', deltaDays: -5 }, ginkgo: { peak: '11-27', normal: '11-25', deltaDays: 2 } },
]

// 這份預測的日曆年。'MM-DD' 字串不帶年份,統一補這一年。
export const FORECAST_YEAR = 2026
