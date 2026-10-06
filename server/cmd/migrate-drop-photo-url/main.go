// Command migrate-drop-photo-url 是一次性維運工具:把這次「徹底移除」
// 重構後已經確認不再被任何程式碼讀寫的資料庫欄位真正從 schema 刪除
// (ALTER TABLE ... DROP COLUMN ...)。
//
// 涵蓋的欄位:
//
//   - attractions.photo_url——早期還沒有「地點照片漸進補圖機制」
//     (place_details_cache/google_place_photos/photo_assets 三張表)時,
//     人工建檔當下自動查 Pexels 補一張示意圖、或由使用者透過 CLI
//     -photo-url 手動帶入的相容欄位。隨著主題卡改成一律透過 PlaceID
//     走漸進補圖機制取得照片(見 model.Attraction.PlaceID 的完整說明),
//     這個欄位早已不是任何畫面的有效照片來源,「徹底移除 photoUrl
//     相容欄位」重構已經把所有讀寫這個欄位的程式碼(attractionRow.
//     PhotoURL/model.Attraction.PhotoURL 兩個 Go struct 欄位、store 層的
//     UpdateAttractionPhoto、API 層自動查 Pexels 補圖與回寫的邏輯)一併
//     移除。
//   - place_details_cache.new_photo_count/google_photo_target_count——
//     舊版漸進補圖機制(shouldAddGooglePlacePhoto/
//     resetPhotoProgressOnTargetChange)靠這兩個計數器決定要不要補圖,
//     但「已補張數追上目標值」後即使 photo_assets 裡的照片已經過期也
//     永遠不會重新觸發(清水寺是實際踩到的案例)。新機制
//     (photoCapForClickCount/decidePlacePhotoRefreshIndex,見
//     server/internal/api/geo_outline.go 的完整說明)改成直接查
//     photo_assets 的新鮮度狀態,不再需要這兩個計數器,連同它們的
//     讀寫程式碼(store.UpdatePlacePhotoProgress/
//     PlaceDetailsCacheRowExists/ListPlaceDetailsWithZeroPhotoTarget、
//     adminconsole 的「Google 照片 target=0 核對」後台頁)都已經一併
//     移除。
//
// GORM AutoMigrate 不會主動刪除資料庫裡已經不再對應任何 struct 欄位的
// 舊欄位,這支工具就是補上「真正把欄位從 schema 砍掉」這最後一步。
//
// 跟 cmd/migrate-photo-assets 不一樣,這裡不需要像它那樣拆成
// migrate/delete 兩個獨立子命令分階段執行——那支工具的「先搬資料、
// 確認搬移成功、再刪除來源表資料」兩階段設計,是因為資料本身需要先
// 驗證遷移正確性才能安全刪除來源;這支工具單純砍幾個已經確認不再被
// 任何程式碼讀寫的欄位(欄位本身不是「需要先搬去別處才能刪除」的資料,
// 相容欄位的移除已經在前面的程式碼變更階段完成),不存在「搬移是否
// 成功」這個中間狀態需要驗證,因此一個步驟、一次執行就足夠。
//
// 冪等設計:執行前會先用 information_schema(透過 GORM Migrator
// HasColumn,見 store.HasColumn 的完整說明)檢查每個欄位是否還存在——
// 已經不存在的(例如這支工具先前已經成功執行過一次,或這個環境的
// 資料庫本來就沒有這個舊欄位)直接印出訊息略過,不會因為重複執行而對
// 一個已經不存在的欄位再次嘗試 DROP COLUMN 出錯。各欄位獨立判斷、
// 獨立執行,其中一個失敗不影響其餘欄位的處理。
//
// 用法:
//
//	migrate-drop-photo-url [-dry-run]
//
// 環境變數(對齊 cmd/migrate-photo-assets 的既有慣例):
//
//	DATABASE_URL  必要,見 store.Open 的 dsn 參數說明。
//
// -dry-run(預設關閉)只印出即將執行的 SQL,不實際連線執行 DROP COLUMN
// ——這是真正不可逆的 schema 變更,執行前強烈建議先用這個旗標確認
// 影響範圍,理由同 cmd/migrate-photo-assets 的既有慣例。
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/tim72117/tripace/internal/store"
)

// columnToDrop 描述一個要刪除的欄位——table/column 皆為資料庫實際的
// 名稱字串(見 store.HasColumn/DropColumn 的完整說明)。
type columnToDrop struct {
	table  string
	column string
}

func main() {
	fs := flag.NewFlagSet("migrate-drop-photo-url", flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "只印出即將執行的 SQL,不實際連線執行 DROP COLUMN")
	if err := fs.Parse(os.Args[1:]); err != nil {
		log.Fatalf("解析參數失敗: %v", err)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("缺少 DATABASE_URL 環境變數")
	}

	columns := []columnToDrop{
		{table: "attractions", column: "photo_url"},
		{table: "place_details_cache", column: "new_photo_count"},
		{table: "place_details_cache", column: "google_photo_target_count"},
	}

	// -dry-run 時完全不連線資料庫——理由同 cmd/migrate-photo-assets 的
	// 既有慣例:dry-run 應該是「連 DATABASE_URL 是否正確都還沒驗證」也能
	// 安全執行的純展示模式,不該因為連線本身失敗而中斷,讓使用者在真正
	// 準備執行前,至少能先看到這支工具打算做什麼。
	if *dryRun {
		for _, c := range columns {
			fmt.Printf("[dry-run] 將會執行: ALTER TABLE %s DROP COLUMN %s;\n", c.table, c.column)
		}
		fmt.Println("[dry-run] 未實際連線資料庫,不會做任何檢查或變更。")
		return
	}

	st, err := store.Open(dsn)
	if err != nil {
		log.Fatalf("開啟資料庫失敗: %v", err)
	}
	defer func() {
		if err := st.Close(); err != nil {
			log.Printf("關閉資料庫連線失敗(不影響本次執行結果): %v", err)
		}
	}()

	for _, c := range columns {
		if !st.HasColumn(c.table, c.column) {
			fmt.Printf("%s.%s 欄位已經不存在,無需任何動作(冪等,安全結束)。\n", c.table, c.column)
			continue
		}
		fmt.Printf("執行: ALTER TABLE %s DROP COLUMN %s;\n", c.table, c.column)
		if err := st.DropColumn(c.table, c.column); err != nil {
			log.Fatalf("DROP COLUMN %s.%s 失敗: %v", c.table, c.column, err)
		}
		fmt.Printf("完成:%s.%s 欄位已刪除。\n", c.table, c.column)
	}
}
