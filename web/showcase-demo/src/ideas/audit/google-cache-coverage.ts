import type { IdeaDoc } from '../types'

// 稽核報告:Google API 快取涵蓋範圍(2026-10-21)。
// 這個頁面本身就是原始文件(無 docs/ 對應檔),所以不填 source。
export const AUDIT_GOOGLE_CACHE_COVERAGE: IdeaDoc = {
  id: 'audit-google-cache-coverage',
  group: 'audit',
  order: 1,
  title: 'Google API 快取涵蓋範圍稽核(2026-10-21)',
  summary:
    '盤點後端所有會打 Google 的端點:哪些已經有快取、哪些沒有、哪些連 gateway 都繞過。起因是 10/19 帳單 GetPlace 與請求數 1:1;這份報告同時記錄這批已完成的統一快取、實測數據、獨立審查找到的缺陷,以及等待決定的後續範圍。',
  tags: ['Google Places', '快取', '成本控制', '稽核'],
  sections: [
    {
      heading: '範圍與方法',
      paragraphs: [
        '目的:回答「所有會打 Google API 的端點,是不是都走快取」。結論是:不是。目前只有「地點詳情(places.get)」被統一快取保護,搜尋、附近搜尋、地理編碼、路線都沒有任何結果快取。',
        '方法:三個子代理平行做唯讀盤點(端點到 Google 呼叫的完整對照、同一操作被不同程式碼區塊各寫一份的重複實作、快取層本身與繞過統一 client 的呼叫),再由本人抽查最關鍵的主張、並用本地實測驗證。',
      ],
      bullets: [
        '盤點當時本人已讀碼確認(除 pace_route.go 繞過 gateway 仍未處理、place_pexels_photos 資料表未刪之外,其餘此後都已修,見各節):place-details-any 未建檔分支不讀快取;GetCachedPlaceDetails(placeID, 0) 因 maxAge=0 恆未命中;pace_route.go 用 http.DefaultClient 直接打 routes.googleapis.com;textOnly 未命中分支不寫快取;SetCachedPlaceDetails 是 upsert,會洗掉 rating 並重設 fetched_at;place_pexels_photos 除了寫入它的函式自己之外沒有任何讀取(該函式與讀寫已移除,資料表未刪);前端資料來源層沒有任何去重。',
        '其餘盤點結果來自子代理報告,我沒有逐行驗證;文中以「子代理報告」標示。',
      ],
    },
    {
      heading: '起因:10/19 帳單與逐小時對照',
      paragraphs: [
        'Cloud Billing 的日期是太平洋時間,帳單上的「10/19」是台灣 10/19 15:00 到 10/20 15:00。這一天 Places API(New) 共 989 筆請求,約 US$14.5;10/1 到 10/20 累計 US$27.78,報表顯示優惠 US$0.00(免費額度沒有被折抵,先前「實際帳單可能是 0」的判斷是錯的)。',
        '逐小時對照:台灣 10/20 12:00、13:00、14:00,Google 收到的 GetPlace 是 163、180、93,與本地 server 的 place-details-any 請求數完全一致,代表每個請求都直接變成一次計費。',
      ],
      table: {
        headers: ['帳單日(太平洋時間)', '請求數', 'GetPlace', 'GetPhotoMedia', 'SearchNearby', 'SearchText'],
        rows: [
          ['10/18', '200', '105', '60', '15', '20'],
          ['10/19', '989', '748', '166', '44', '30'],
          ['10/20', '430', '292', '88', '36', '13'],
        ],
      },
      note: '以上是 Cloud Monitoring 的 request_count,不是帳單金額;金額要看 Cloud Billing 的 SKU 報表。GetPlace 的計費層級取決於實際帶的 field mask(是否含 editorialSummary),從請求數看不出來。',
    },
    {
      heading: '已加入快取的範圍',
      paragraphs: ['目前只有一種 Google 操作被統一快取保護:地點詳情 places.get。實作放在 geo.Client 層,並提供行程內預設快取,讓 geo.New() 建出來的 client 自動帶上,呼叫者無法跳過。'],
      table: {
        headers: ['路徑', '處理方式', '位置'],
        rows: [
          ['place-details-any 未建檔地點', '先讀快取、未命中才打 Google、並發請求共用一次呼叫', 'api/geo_outline.go fetchAndCachePlaceDetails'],
          ['place-details 的 textOnly 未命中', '改走可注入的 client 工廠,自動帶統一快取,結果寫回', 'api/geo_outline.go textOnly 分支'],
          ['補圖與文字過期重抓', '用 GetPlaceDetailsFresh(明確要新資料,結果仍寫回快取)', 'api/geo_outline.go backgroundFillPlacePhoto、textStale'],
          ['已建檔分支', '不再用 rating=0 覆蓋快取列;列不存在時只建一列「過期」的湊合列', 'api/geo_plan_ai.go + store.EnsureCachedPlaceDetailsRow'],
          ['照片補圖', '記錄該地點實際張數;有效上限取 min(點擊數上限, 實際張數, 設定上限);補圖去重', 'api/photo_max_count.go、geo_outline.go'],
          ['前端 placeDetails', '資料來源層去重:進行中共用、完成後短期記憶(照片補圖中的結果不記憶)', 'web/src/home/plan-ai-sim/placeDetailsDedupe.ts'],
        ],
      },
    },
    {
      heading: '尚未快取的範圍(重點)',
      paragraphs: ['以下全部沒有任何結果快取;geo.Client 層除了照片位元組(PhotoCache)之外沒有其他快取(子代理報告,本人掃描呼叫點確認)。'],
      table: {
        headers: ['Google 操作', '呼叫點', '觸發情境', '備註'],
        rows: [
          ['文字搜尋 places.searchText', 'handleGeoGeocode(geo_outline.go:464/513/543)', '地圖搜尋框每次輸入,每請求 1 到 2 次', '原本背景還會下載照片預熱,已移除'],
          ['文字搜尋', 'AI place-search(geo_plan_ai.go:132)', 'LLM 的 search_attraction 工具', '另受 public.placeSearch 限流'],
          ['文字搜尋', 'SearchCityAttractions(geo_outline.go:234)', '資料庫沒有建檔的城市', '先查 attractions 表,為空才打'],
          ['文字搜尋', '維運 geocode、update-photo、後台重查 place_id', '管理員手動', ''],
          ['文字搜尋', 'onagenttools geocode、recommend_nearby', 'onagent 平台主動呼叫', '無認證、無節流(程式註解稱 PoC 階段刻意)'],
          ['附近搜尋 places.searchNearby', 'fetchNearbyHotels(geo_outline.go:114)', '每次附近查詢', '照片部分有 photo_cache'],
          ['附近搜尋', 'AI attraction-search(geo_plan_ai.go:315)', '資料庫候選不足 10 筆時', '本地實測每開一次詢問頁打 1 次'],
          ['附近搜尋', 'onagent recommend_nearby', '同上', '每次 1 次 searchText 加 1 次 searchNearby'],
          ['Geocoding API', 'entry_geocode.go:81(client.Geocode)', '每次', '連「entry 已有座標就略過」都沒有'],
          ['Routes API computeRoutes', 'pace_route.go:156(3 個端點)', '每次', '只有 demo 端點有行程內記憶體快取;見下方繞過 gateway'],
        ],
      },
    },
    {
      heading: '繞過 gateway 的呼叫',
      paragraphs: [
        'internal/geo 加 internal/apigateway 是統一出口(限流、每日額度、geo_api_call_logs 呼叫紀錄)。以下呼叫不經過它,所以沒有限流、沒有每日額度、不會出現在呼叫紀錄,Cloud Billing 也就對不上(本人已確認 pace_route.go 的 http.DefaultClient;其餘為子代理報告)。',
      ],
      table: {
        headers: ['位置', '打什麼', '保護'],
        rows: [
          ['api/pace_route.go:155-164', 'POST routes.googleapis.com computeRoutes', '只有 5 秒逾時;/v1/public/{token}/compute-route 是公開路由,沒看到節流'],
          ['adminconsole/health.go:139-150', 'places:searchText(固定 Taipei 101)', '管理員手動觸發,無任何保護'],
          ['scripts/test-places-key.sh、update-secret-manager.sh', 'curl places:searchText', '人工執行的腳本'],
        ],
      },
      note: '前端瀏覽器端只使用 Maps JavaScript 的 maps、marker、geometry 三個 library,沒有 Places、Geocoder、Directions、Autocomplete(子代理報告)。地圖載入計費不是後端快取管得到的範圍。',
    },
    {
      heading: '快取層現況',
      table: {
        headers: ['名稱', '位置', 'key', '有效期', '狀態'],
        rows: [
          ['photo_cache', 'store.photoCacheRow,geo.PhotoCache 介面', 'place_id、photo_index、寬度', '7 天', '唯一在 geo 層的快取,只管照片位元組;client 必須 SetCache 才生效'],
          ['place_details_cache', 'store.placeDetailsCacheRow', 'place_id', '可設定,預設 24 小時(geo 層判斷)', '這批統一;另保留 30 天「列是否存在」的既有判斷'],
          ['photo_assets', 'store.photoAssetRow', 'place_id、photo_index、usage', '可設定,預設 7 天', '補圖是否需要重做的依據;只影響之後寫入的資產'],
          ['place_pexels_photos', 'store.placePexelsPhotoRow', 'place_id、photo_index', '無', '資料表尚未刪除:程式碼的讀寫已全部移除(2026-10-21),型別定義、AutoMigrate、schema_check 登記與資料表本身還在,待刪(正式機要先備份再 drop)'],
          ['google_place_photos', 'store.googlePlacePhotoRow', 'place_id、photo_index', '無', '死資料表,非測試程式碼無呼叫端(子代理報告)'],
          ['pexels_photo_cache', 'store.pexelsPhotoCacheRow', 'search_query', '呼叫端決定', '未接線,Pexels client 在正式環境為 nil(子代理報告)'],
        ],
      },
    },
    {
      heading: '重複實作與不一致(只列未修)',
      bullets: [
        '已修(資料表未刪):warmPlaceDetailsPhotoCache 與 mergePhotoURLIntoPlaceDetailsCache 已移除,geocode 不再背景下載照片;它們寫入的 place_pexels_photos 資料表還沒刪除。',
        '未修:無效 placeId 的 ErrNotFound 沒有負快取,每次都重打。',
        '未修:caller 與 path 標籤不一致——onagenttools 沒有 path;AI 版地點詳情借用 handleGeoPlaceDetails 標籤;兩處 path 寫死。geo_api_call_logs 不好對帳。(子代理報告)',
        '未修:地圖版 handleGeoPlaceDetails 命中分支自己有一套 30 天存在加 24 小時新鮮的判斷,與統一快取重複。(獨立審查發現;textStale 寫死 24 小時的部分已修)',
      ],
    },
    {
      heading: '前端重複請求(子代理報告)',
      bullets: [
        '詢問頁(AskPage)與時間軸(resolveAttractionForStep)對同一 placeId 各請求一次;原因是兩者在展示頁/訪客路徑拿到的不是同一個資料來源實例,去重因此做在模組層級的登錄表(依 baseURL 與 token 分範圍)。',
        '去重沒涵蓋:transitEstimate、AskPage 的 searchNearby(candidates 變動就重打)、公開路徑的 photoAssets。',
        '地圖版只有 3 個呼叫點用共用的 placeDetailsCache.ts,另有 8 個呼叫點直接呼叫後端、繞過它,可能與預取重複請求同一個 placeId。',
        '每個重複請求在後端都會累加點擊數,間接抬高補圖上限。',
      ],
    },
    {
      heading: '實測數據(本地,2026-10-21)',
      paragraphs: [
        '方法:本地 server(連本機資料庫與真實 Google API key),在瀏覽器開 /ai-plan?skipDemo=1,選「台灣」再選城市,量 geo_api_call_logs 在這段時間新增的呼叫。每個地點約請求 2 次(共 20 個前端請求對 10 個地點)。',
      ],
      table: {
        headers: ['情境', 'places.get', 'places.photoMedia', 'places.searchNearby'],
        rows: [
          ['屏東第 1 次(冷),改動前', '20', '20', '1'],
          ['屏東第 2 次(熱),改動前', '20', '0', '1'],
          ['屏東(昨天已有快取資料),統一快取後', '0', '0', '1'],
          ['彰化第 1 次(冷),統一快取後', '10', '10', '1'],
          ['彰化第 2 次(熱),統一快取後', '0', '0', '1'],
        ],
      },
      note: '台南兩次都是 0 次 Google 呼叫,但那是因為地點都已建檔且昨天補過圖,鑑別力不足,不列入對照。searchNearby 仍每開一次打 1 次,因為搜尋類快取還沒做。',
    },
    {
      heading: '這批的設計與可調設定',
      bullets: [
        'geo.Client.GetPlaceDetails 先讀快取,新鮮就回(FromCache=true、PhotoRefs=nil);未命中才打 Google 並寫回。GetPlaceDetailsFresh 一定打 Google。快取只存文字欄位,照片參照有時效、不存。',
        '同一個 placeID 的並發未命中共用一次 Google 呼叫(自己寫的小型 singleflight)。',
        'geo.SetDefaultDetailsCache 在 cmd/server 啟動時設定,之後 geo.New() 自動帶上;NewWithGateway(測試用)刻意不吃全域預設。',
        '快取命中時照常累加點擊數與做補圖判斷;命中時 PhotoRefs 是 nil,不可被當成「這個地點沒有照片」(不寫 photo_count)。',
        '背景補圖去重:同一地點同一張照片同時只補一次;搶到標記後再確認一次是否已新鮮。',
      ],
      table: {
        headers: ['設定(tripace-cli geo-setting)', '預設', '範圍', '作用'],
        rows: [
          ['photoMaxCount', '3', '1 到 20', '每個地點最多補幾張照片;有效上限 = min(點擊數上限, 該地點實際張數, 這個設定)'],
          ['photoExpiryDays', '7', '1 到 30', '照片資產有效天數;只影響之後寫入的照片'],
          ['placeDetailsCacheHours', '24', '1 到 720', '地點詳情快取有效期;所有走 geo 層的端點共用'],
        ],
      },
      note: '三項設定都限管理員修改(internalAuth 只驗 JWT 簽章、不判斷角色,每支 handler 自己檢查),非法值一律拒絕不靜默修正,寫入後立即套用到該實例,多實例約 45 秒內跟上。',
    },
    {
      heading: '獨立審查發現(只列未修)',
      paragraphs: ['兩輪獨立審查與突變檢驗的結果。已修的項目(領頭者 panic 卡死、Fresh 加入命中快取的領頭者、領頭者忽略自己的 context、mergePhotoURL 覆寫整列、textStale 寫死 24 小時、photo_count=0 在地圖版重查時不更正)都先寫了紅燈測試再修,此處不再列。處理規則不變:先寫測試重現,再修。'],
      table: {
        headers: ['問題', '嚴重度', '狀態'],
        rows: [
          ['並發去重登錄表是 process 全域,不分 client、gateway、apiKey', '中', '文件化,不修'],
          ['geo 層有效期是 process 全域,多個 Server 實例會互相覆蓋', '輕微', '文件化,不修'],
          ['設定背景重讀可能用舊快照蓋掉剛 PATCH 的值,最多 45 秒後恢復', '中', '未修,視窗小'],
          ['CLI 預設 -api 是正式機,geo-setting set 沒標示目標環境', '輕微', '待決定:輸出時印出目標主機'],
          ['前端把 photoRefreshPending=false 的結果記憶 5 分鐘,點擊數不再累加,漸進補圖變慢', '中', '待決定:保留或縮短'],
          ['前端登錄表淘汰是 FIFO,不是 LRU;TTL 邊界、淘汰、同步例外沒有測試', '輕微', '未修'],
          ['維運端點沒有 body 大小限制、尾端垃圾被接受、CLI 多餘參數被靜默忽略', '輕微', '未修,與既有慣例一致'],
          ['突變檢驗存活:領頭者 WithoutCancel、再檢查路徑的 FromCache 與 PhotoRefs 清除、補圖搶到標記後的重新確認(對照改寫前的版本)', '輕微', '待補測試'],
        ],
      },
    },
    {
      heading: '待決定與後續',
      bullets: [
        '搜尋、附近搜尋、地理編碼、路線需要新資料表(例如 geo_query_cache,key 為請求內容雜湊)。尚未得到同意。',
        '搜尋結果(名稱、地址、座標)快取的時效與 Google 條款:現有程式碼已快取地點文字(24 小時與 30 天),但我沒有查現行條款。需要先確認再擴大範圍。',
        'Routes API 改走 gateway 會開始受限流並寫呼叫紀錄(需要新增一條限流規則),行為會改變。尚未得到同意。',
        '/onagent/geocode 與 /onagent/recommend_nearby 沒有認證與節流,屬於安全性議題,不在這次快取範圍,是否排進去待決定。',
        '清理死碼:warmPlaceDetailsPhotoCache 已移除。資料表 place_pexels_photos 還未刪除(要連同 placePexelsPhotoRow、AutoMigrate、schema_check 一併處理,正式機先備份);fetchPhotosForCandidates 已無呼叫端,尚未刪除。google_place_photos 仍被 cmd/migrate-photo-assets 使用,不能刪。',
        '前端:AskPage 的 searchNearby、transitEstimate、公開路徑 photoAssets 去重;地圖版 8 個直接呼叫點改走共用快取。',
      ],
    },
    {
      heading: '未驗證與限制',
      bullets: [
        '子代理報告中標「未驗證」的項目,以及我沒有逐行讀過的部分(例如 wanttools 是否仍有呼叫端、cmd/server 其他路由是否另有直接呼叫 Google)。',
        '費用是用公開單價估算,不是帳單;實際計費層級取決於 field mask,Cloud Monitoring 看不出來。',
        '突變檢驗與部分 api 測試依賴背景 goroutine 與計時,偶爾可能不穩;我用重跑多次確認,但這不等於證明沒有競態(這台機器沒有 cgo,跑不了 -race)。',
        '實測只用兩個城市,且是單一使用者操作,不代表真實並發流量。',
      ],
    },
  ],
  verdict:
    '目前的狀態:地點詳情已經統一快取並實測見效(熱路徑 places.get 從每請求 1 次降到 0),但「所有打 Google 的端點都走快取」還只完成其中一類。剩下的搜尋、附近搜尋、地理編碼、路線都沒有快取,其中路線還繞過 gateway、onagent 兩支沒有認證。建議順序:獨立審查的中度問題已修完,先 commit 這一批,再依你對時效合規、新資料表、路線改走 gateway 的決定,做第二批(在 geo 層加通用的查詢結果快取,讓新增端點也不會漏)。',
}
