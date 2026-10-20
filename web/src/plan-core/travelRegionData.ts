// travelRegionData.ts — ask_travel_region(見 askPageTools.ts 的完整
// 說明)用的固定「國家 → 熱門城市/區域」兩層清單。
//
// 2026-10(第六輪,使用者明確要求「詢問區域的 UI 不要做太細,主要是選
// 國家跟區域」「UI 本身設定好選項,可以自動預設顯示,也可以透過 LLM
// 進行部分控制」):這份清單原本是 LLM 透過 options 參數自己決定要列出
// 哪些候選(見 askPageTools.ts 開頭「第五輪」的完整說明),改成前端
// 內建固定清單——跟 TransportMode/ALL_TRANSPORT_MODES 的既有模式
// (見該常數的完整說明)看齊:LLM 不再自己發明候選內容,只能從這份固定
// 清單裡篩選/排序要顯示哪些,避免每次呼叫列出的國家/城市不一致、或
// 列出使用者實際用不到的奇怪地名。
//
// 兩層資料(國家/城市)寫在同一個檔案、用同一組 id 系統關聯,不拆成
// 兩個檔案——這份清單本身就是「國家底下固定幾個熱門城市」這種緊密
// 耦合的樹狀結構,拆開只會讓查詢城市清單時多一道「先去另一個檔案查
// 國家 id 對不對」的間接層,沒有實際好處。
//
// id 命名規則:國家用小寫英文(常用慣例縮寫或拼音,例如 japan/korea),
// 城市用「國家id-城市拼音」(例如 japan-tokyo)——避免不同國家底下剛好
// 有同名城市(例如很多國家都有「聖荷西」)時 id 衝突。

export interface TravelRegionOption {
  id: string
  name: string
}

// TravelCity——城市/區域層,比國家多帶 lat/lng(WGS84 經緯度,精確到小數點
// 後4位即可),之後拿去打 Google Places Nearby Search API 查該城市附近的
// 景點用。國家本身不需要座標意義,維持用 TravelRegionOption(id/name)就好,
// 不讓 TravelCountry 繼承 TravelRegionOption 再多出用不到的欄位。
export interface TravelCity extends TravelRegionOption {
  lat: number
  lng: number
}

export interface TravelCountry extends TravelRegionOption {
  cities: TravelCity[]
}

// TRAVEL_COUNTRIES——台灣人常去的旅遊國家,依亞洲/大洋洲/歐美排序
// (對齊一般旅遊網站的分類直覺:近程常去的排前面)。每個國家固定
// 4-6 個熱門城市/區域,單一城市的國家(新加坡/香港/澳門)只列一筆。
//
// 2026-10(第八輪,使用者明確要求「台灣全部」):台灣是唯一例外,列出
// 全部 22 個直轄市/縣市(不是像其他國家那樣只挑幾個熱門城市)——這個
// app 本身的展示情境(/ai-plan 的台南行程劇本)就是台灣國內旅遊,清單
// 裡沒有台灣本身是明顯缺口,且使用者對本國的城市/縣市掌握度本來就
// 比對外國城市更細,全部列出比挑幾個「熱門的」更貼近實際需求。排在
// 清單最前面(國內旅遊優先度最高,不是依前面註解的近程/遠程排序)。
export const TRAVEL_COUNTRIES: TravelCountry[] = [
  { id: 'taiwan', name: '台灣', cities: [
    { id: 'taiwan-taipei', name: '台北', lat: 25.0330, lng: 121.5654 },
    { id: 'taiwan-newtaipei', name: '新北', lat: 25.0120, lng: 121.4657 },
    { id: 'taiwan-taoyuan', name: '桃園', lat: 24.9936, lng: 121.3010 },
    { id: 'taiwan-taichung', name: '台中', lat: 24.1477, lng: 120.6736 },
    { id: 'taiwan-tainan', name: '台南', lat: 22.9997, lng: 120.2270 },
    { id: 'taiwan-kaohsiung', name: '高雄', lat: 22.6273, lng: 120.3014 },
    { id: 'taiwan-keelung', name: '基隆', lat: 25.1276, lng: 121.7392 },
    { id: 'taiwan-hsinchucity', name: '新竹市', lat: 24.8138, lng: 120.9675 },
    { id: 'taiwan-hsinchucounty', name: '新竹縣', lat: 24.8390, lng: 121.0177 },
    { id: 'taiwan-miaoli', name: '苗栗', lat: 24.5602, lng: 120.8214 },
    { id: 'taiwan-changhua', name: '彰化', lat: 24.0518, lng: 120.5161 },
    { id: 'taiwan-nantou', name: '南投', lat: 23.9609, lng: 120.9718 },
    { id: 'taiwan-yunlin', name: '雲林', lat: 23.7092, lng: 120.4313 },
    { id: 'taiwan-chiayicity', name: '嘉義市', lat: 23.4801, lng: 120.4491 },
    { id: 'taiwan-chiayicounty', name: '嘉義縣', lat: 23.4518, lng: 120.2555 },
    { id: 'taiwan-pingtung', name: '屏東', lat: 22.5519, lng: 120.5487 },
    { id: 'taiwan-yilan', name: '宜蘭', lat: 24.7021, lng: 121.7378 },
    { id: 'taiwan-hualien', name: '花蓮', lat: 23.9871, lng: 121.6015 },
    { id: 'taiwan-taitung', name: '台東', lat: 22.7583, lng: 121.1444 },
    { id: 'taiwan-penghu', name: '澎湖', lat: 23.5711, lng: 119.5793 },
    { id: 'taiwan-kinmen', name: '金門', lat: 24.4493, lng: 118.3767 },
    { id: 'taiwan-lienchiang', name: '馬祖', lat: 26.1604, lng: 119.9349 },
  ] },
  { id: 'japan', name: '日本', cities: [
    { id: 'japan-tokyo', name: '東京', lat: 35.6895, lng: 139.6917 },
    { id: 'japan-osaka', name: '大阪', lat: 34.6937, lng: 135.5023 },
    { id: 'japan-kyoto', name: '京都', lat: 35.0116, lng: 135.7681 },
    { id: 'japan-okinawa', name: '沖繩', lat: 26.2124, lng: 127.6809 },
    { id: 'japan-hokkaido', name: '北海道', lat: 43.0618, lng: 141.3545 },
    { id: 'japan-fukuoka', name: '福岡', lat: 33.5904, lng: 130.4017 },
  ] },
  { id: 'korea', name: '韓國', cities: [
    { id: 'korea-seoul', name: '首爾', lat: 37.5665, lng: 126.9780 },
    { id: 'korea-busan', name: '釜山', lat: 35.1796, lng: 129.0756 },
    { id: 'korea-jeju', name: '濟州島', lat: 33.4996, lng: 126.5312 },
  ] },
  { id: 'thailand', name: '泰國', cities: [
    { id: 'thailand-bangkok', name: '曼谷', lat: 13.7563, lng: 100.5018 },
    { id: 'thailand-chiangmai', name: '清邁', lat: 18.7883, lng: 98.9853 },
    { id: 'thailand-phuket', name: '普吉', lat: 7.8804, lng: 98.3923 },
    { id: 'thailand-pai', name: '蘆芽', lat: 19.3583, lng: 98.4397 },
  ] },
  { id: 'vietnam', name: '越南', cities: [
    { id: 'vietnam-hanoi', name: '河內', lat: 21.0285, lng: 105.8542 },
    { id: 'vietnam-halong', name: '下龍灣', lat: 20.9101, lng: 107.1839 },
    { id: 'vietnam-danang', name: '峴港', lat: 16.0544, lng: 108.2022 },
    { id: 'vietnam-hoian', name: '會安', lat: 15.8801, lng: 108.3380 },
  ] },
  { id: 'singapore', name: '新加坡', cities: [
    { id: 'singapore-singapore', name: '新加坡', lat: 1.3521, lng: 103.8198 },
  ] },
  { id: 'malaysia', name: '馬來西亞', cities: [
    { id: 'malaysia-kualalumpur', name: '吉隆坡', lat: 3.1390, lng: 101.6869 },
    { id: 'malaysia-penang', name: '檳城', lat: 5.4141, lng: 100.3288 },
    { id: 'malaysia-malacca', name: '麻六甲', lat: 2.1896, lng: 102.2501 },
    { id: 'malaysia-langkawi', name: '蘭卡威', lat: 6.3500, lng: 99.8000 },
  ] },
  { id: 'hongkong', name: '香港', cities: [
    { id: 'hongkong-hongkong', name: '香港', lat: 22.3193, lng: 114.1694 },
  ] },
  { id: 'macau', name: '澳門', cities: [
    { id: 'macau-macau', name: '澳門', lat: 22.1987, lng: 113.5439 },
  ] },
  { id: 'china', name: '中國大陸', cities: [
    { id: 'china-shanghai', name: '上海', lat: 31.2304, lng: 121.4737 },
    { id: 'china-beijing', name: '北京', lat: 39.9042, lng: 116.4074 },
    { id: 'china-chengdu', name: '成都', lat: 30.5728, lng: 104.0668 },
    { id: 'china-hangzhou', name: '杭州', lat: 30.2741, lng: 120.1551 },
    { id: 'china-suzhou', name: '蘇州', lat: 31.2989, lng: 120.5853 },
  ] },
  { id: 'philippines', name: '菲律賓', cities: [
    { id: 'philippines-manila', name: '馬尼拉', lat: 14.5995, lng: 120.9842 },
    { id: 'philippines-cebu', name: '宿霧', lat: 10.3157, lng: 123.8854 },
    { id: 'philippines-boracay', name: '長灘島', lat: 11.9674, lng: 121.9248 },
  ] },
  { id: 'indonesia', name: '印尼', cities: [
    { id: 'indonesia-bali', name: '峇里島', lat: -8.4095, lng: 115.1889 },
    { id: 'indonesia-ubud', name: '烏布', lat: -8.5069, lng: 115.2625 },
    { id: 'indonesia-giliislands', name: '吉利群島', lat: -8.3505, lng: 116.0404 },
  ] },
  { id: 'cambodia', name: '柬埔寨', cities: [
    { id: 'cambodia-siemreap', name: '暹粒', lat: 13.3671, lng: 103.8448 },
    { id: 'cambodia-phnompenh', name: '金邊', lat: 11.5564, lng: 104.9282 },
    { id: 'cambodia-sihanoukville', name: '施亞努市', lat: 10.6104, lng: 103.5300 },
  ] },
  { id: 'australia', name: '澳洲', cities: [
    { id: 'australia-sydney', name: '雪梨', lat: -33.8688, lng: 151.2093 },
    { id: 'australia-melbourne', name: '墨爾本', lat: -37.8136, lng: 144.9631 },
    { id: 'australia-brisbane', name: '布里斯本', lat: -27.4698, lng: 153.0251 },
    { id: 'australia-goldcoast', name: '黃金海岸', lat: -28.0167, lng: 153.4000 },
  ] },
  { id: 'newzealand', name: '紐西蘭', cities: [
    { id: 'newzealand-auckland', name: '奧克蘭', lat: -36.8485, lng: 174.7633 },
    { id: 'newzealand-queenstown', name: '皇后鎮', lat: -45.0312, lng: 168.6626 },
    { id: 'newzealand-christchurch', name: '基督城', lat: -43.5321, lng: 172.6362 },
  ] },
  { id: 'usa', name: '美國', cities: [
    { id: 'usa-newyork', name: '紐約', lat: 40.7128, lng: -74.0060 },
    { id: 'usa-losangeles', name: '洛杉磯', lat: 34.0522, lng: -118.2437 },
    { id: 'usa-sanfrancisco', name: '舊金山', lat: 37.7749, lng: -122.4194 },
    { id: 'usa-lasvegas', name: '拉斯維加斯', lat: 36.1699, lng: -115.1398 },
    { id: 'usa-hawaii', name: '夏威夷', lat: 21.3069, lng: -157.8583 },
  ] },
  { id: 'canada', name: '加拿大', cities: [
    { id: 'canada-toronto', name: '多倫多', lat: 43.6532, lng: -79.3832 },
    { id: 'canada-vancouver', name: '溫哥華', lat: 49.2827, lng: -123.1207 },
    { id: 'canada-niagarafalls', name: '尼加拉瀑布', lat: 43.0896, lng: -79.0849 },
    { id: 'canada-calgary', name: '卡加利', lat: 51.0447, lng: -114.0719 },
  ] },
  { id: 'uk', name: '英國', cities: [
    { id: 'uk-london', name: '倫敦', lat: 51.5074, lng: -0.1278 },
    { id: 'uk-edinburgh', name: '愛丁堡', lat: 55.9533, lng: -3.1883 },
    { id: 'uk-manchester', name: '曼徹斯特', lat: 53.4808, lng: -2.2426 },
  ] },
  { id: 'france', name: '法國', cities: [
    { id: 'france-paris', name: '巴黎', lat: 48.8566, lng: 2.3522 },
    { id: 'france-nice', name: '尼斯', lat: 43.7102, lng: 7.2620 },
    { id: 'france-provence', name: '普羅旺斯', lat: 43.9493, lng: 4.8055 },
  ] },
  { id: 'italy', name: '義大利', cities: [
    { id: 'italy-rome', name: '羅馬', lat: 41.9028, lng: 12.4964 },
    { id: 'italy-florence', name: '佛羅倫斯', lat: 43.7696, lng: 11.2558 },
    { id: 'italy-venice', name: '威尼斯', lat: 45.4408, lng: 12.3155 },
    { id: 'italy-milan', name: '米蘭', lat: 45.4642, lng: 9.1900 },
  ] },
  { id: 'germany', name: '德國', cities: [
    { id: 'germany-cologne', name: '科隆', lat: 50.9375, lng: 6.9603 },
    { id: 'germany-munich', name: '慕尼黑', lat: 48.1351, lng: 11.5820 },
    { id: 'germany-berlin', name: '柏林', lat: 52.5200, lng: 13.4050 },
  ] },
  { id: 'turkey', name: '土耳其', cities: [
    { id: 'turkey-istanbul', name: '伊斯坦堡', lat: 41.0082, lng: 28.9784 },
    { id: 'turkey-cappadocia', name: '卡帕多奇亞', lat: 38.6431, lng: 34.8286 },
    { id: 'turkey-bursa', name: '布爾薩', lat: 40.1885, lng: 29.0610 },
  ] },
]

// findTravelCountry/findTravelCity——依 id 查單一國家/城市,查無時回傳
// undefined(呼叫端自行決定要怎麼處理,不在這裡丟錯)。
export function findTravelCountry(countryId: string): TravelCountry | undefined {
  return TRAVEL_COUNTRIES.find((c) => c.id === countryId)
}

export function findTravelCity(countryId: string, cityId: string): TravelCity | undefined {
  return findTravelCountry(countryId)?.cities.find((c) => c.id === cityId)
}

// findTravelCityById——2026-10(第七輪,使用者明確要求「LLM 輸入的參數
// 可以控制 flow,像是可以控制區域選完,要不要接景點的工具」)不需要先
// 知道 countryId 就能查城市——TripPlanPage.tsx 的 askTravelRegion
// wrapper 選定城市後只拿到城市 id(見 AskPageSelection.placeId 的完整
// 說明,不帶國家資訊),要查座標串接 search_attraction 時需要這種查法。
// 遍歷全部國家找符合的城市 id——理由同 id 命名規則(見檔頭說明:城市 id
// 本身帶國家前綴,例如「japan-tokyo」,全域唯一),這裡不依賴前綴格式
// 去反推 countryId(萬一命名規則之後改變,遍歷查找仍然正確,不會因為
// id 格式假設跟著壞掉)。
export function findTravelCityById(cityId: string): TravelCity | undefined {
  for (const country of TRAVEL_COUNTRIES) {
    const city = country.cities.find((c) => c.id === cityId)
    if (city) return city
  }
  return undefined
}

// listTravelCountries/listTravelCities——依選填的 id 清單篩選要顯示哪些
// 國家/城市,省略(或空陣列)時回傳全部。
//
// 2026-10 抽出(使用者明確要求「在前端維護一個使用者目前在哪一個畫面,
// 選了那些項目的資訊」):這段篩選邏輯原本只寫在 AskPage.tsx 的
// RegionPanel/CityPanel 內部,而 uiStateStore(要記下「畫面上有哪些
// 選項」)需要算出同一份清單。抽到這裡讓兩邊共用——各自寫一份的話,
// 哪天篩選規則變了(例如改成保持 TRAVEL_COUNTRIES 的原始順序而非照
// countryIds 的順序),兩邊就會不一致,而「LLM 讀到的選項」跟「使用者
// 看到的選項」不一致是最難查的那種 bug。
//
// 順序刻意照傳入的 id 陣列,不是 TRAVEL_COUNTRIES 的原始順序——那是
// RegionPanel 原本的既有行為(LLM 明確要求「篩選/排列優先序」,見
// askPageTools.ts 對 countryIds 的說明),這裡原樣保留。
// 查不到的 id 直接濾掉,不丟錯:理由同 findTravelCountry 的既有處理。
export function listTravelCountries(countryIds?: string[]): TravelCountry[] {
  if (!countryIds || countryIds.length === 0) return TRAVEL_COUNTRIES
  return countryIds.map(findTravelCountry).filter((c): c is TravelCountry => !!c)
}

export function listTravelCities(countryId: string, cityIds?: string[]): TravelCity[] {
  if (cityIds && cityIds.length > 0) {
    return cityIds.map((id) => findTravelCity(countryId, id)).filter((c): c is TravelCity => !!c)
  }
  return findTravelCountry(countryId)?.cities ?? []
}
