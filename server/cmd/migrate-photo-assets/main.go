// Command migrate-photo-assets 是一次性維運工具:把 google_place_photos/
// photo_cache 兩張表目前存放的完整 base64 圖片內容落地到 GCS,新的公開
// URL 寫進獨立的 photo_assets 表(見 server/internal/store/entity.go
// 的 photoAssetRow 完整說明)。
//
// 動機:這兩張表本來設計上該存的是查詢結果的快取,但本機開發環境未設定
// GCS_PHOTO_BUCKET 時,落地上傳會失敗、降級保留原始的 data: URI——正式
// 環境雖然有設定 bucket,仍應該把這批圖片內容遷移到 GCS、資料庫本身
// 不再背負儲存圖片位元組的責任。
//
// 分兩個獨立階段執行,刻意不合併成一個指令:
//
//	migrate    讀出兩張來源表所有紀錄,逐筆上傳 GCS、寫入 photo_assets
//	           (upsert,重複執行是安全的),不動來源表任何資料。
//	delete     逐筆確認某筆紀錄已經在 photo_assets 裡有對應的成功遷移
//	           結果,才把來源表那一列整列刪除。
//
// 這樣拆分讓 migrate 階段可以重複執行、隨時中斷重試、且在刪除任何資料
// 之前有機會先驗證 photo_assets 的內容正確——delete 階段是真正不可逆的
// 操作,必須是使用者確認過 migrate 結果之後才手動執行的獨立步驟,不能
// 在同一次執行裡自動接續發生。
//
// 用法:
//
//	migrate-photo-assets migrate [-dry-run]
//	migrate-photo-assets delete [-dry-run]
//
// 環境變數(對齊 cmd/server/main.go 的既有慣例):
//
//	DATABASE_URL       必要,見 store.Open 的 dsn 參數說明。
//	GCS_PHOTO_BUCKET    必要(留空時 migrate 階段會直接報錯結束,不會靜默
//	                    略過——這支工具存在的唯一目的就是落地到 GCS,
//	                    沒有設定 bucket 執行這支工具沒有意義)。
//
// -dry-run(兩個子命令都支援,預設關閉)只印出將會執行的動作,不實際寫入
// GCS/資料庫或刪除任何資料——執行任何一個子命令前建議先加這個旗標確認
// 影響範圍,理由同其餘維運工具(見 cmd/cli 的 attraction-sync -apply
// 慣例:預設 dry-run,需要明確旗標才真的動資料)。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/store"
)

// photoAssetExpiry — 使用者明確要求「設定過期 1 週」,遷移落地的圖片
// 過期時間統一以執行當下起算 7 天,理由見 photoAssetRow.ExpiresAt 的
// 完整說明。
const photoAssetExpiry = 7 * 24 * time.Hour

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "用法: migrate-photo-assets <migrate|delete> [-dry-run]")
		os.Exit(1)
	}
	sub := os.Args[1]
	fs := flag.NewFlagSet(sub, flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "只印出將會執行的動作,不實際寫入/刪除")
	// placeID:選填的範圍過濾——只處理這一個 place_id 底下的紀錄,其餘
	// 全部略過不動。2026-09 新增,供正式環境第一次執行前先用小範圍(例如
	// 單一地點)驗證整條流程,不需要一次對全部既有紀錄做真實上傳/刪除。
	// 留空(預設)代表處理全部紀錄,對齊工具原本「批次遷移」的設計初衷。
	placeID := fs.String("place-id", "", "只處理這個 place_id(留空代表處理全部)")
	if err := fs.Parse(os.Args[2:]); err != nil {
		log.Fatalf("解析參數失敗: %v", err)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("缺少 DATABASE_URL 環境變數")
	}
	st, err := store.Open(dsn)
	if err != nil {
		log.Fatalf("開啟資料庫失敗: %v", err)
	}

	ctx := context.Background()

	switch sub {
	case "migrate":
		bucket := os.Getenv("GCS_PHOTO_BUCKET")
		if bucket == "" {
			log.Fatal("缺少 GCS_PHOTO_BUCKET 環境變數——這支工具的唯一目的是落地到 GCS,未設定 bucket 執行沒有意義")
		}
		uploader, err := photostorage.New(ctx, bucket)
		if err != nil {
			log.Fatalf("建立 GCS uploader 失敗: %v", err)
		}
		if err := runMigrate(ctx, st, uploader, *dryRun, *placeID); err != nil {
			log.Fatalf("migrate 失敗: %v", err)
		}
	case "delete":
		if err := runDelete(st, *dryRun, *placeID); err != nil {
			log.Fatalf("delete 失敗: %v", err)
		}
	default:
		fmt.Fprintf(os.Stderr, "未知的子命令 %q,應為 migrate 或 delete\n", sub)
		os.Exit(1)
	}
}
