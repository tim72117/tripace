// img2webp 批次把資料夾裡的 JPEG/PNG 圖片轉成適合網頁用的 WebP，同時
// 額外產生一組給 LLM 讀取判斷內容用的小尺寸 JPEG 預覽圖。
//
// 用法：
//
//	img2webp <輸入資料夾> [輸出資料夾]
//
// 行為：
//   - 讀取輸入資料夾裡所有 .jpg/.jpeg/.png（不分大小寫），依 EXIF Orientation
//     自動校正方向（手機直出的照片常見這個問題，不校正會轉出橫躺的圖）。
//   - 網頁用輸出：等比例縮小到最長邊不超過 maxDim，呼叫本機已安裝的
//     cwebp（Google libwebp 官方工具，非 Go 套件）編碼成 WebP，畫質見
//     quality 常數——Go 標準庫沒有 WebP 編碼器，這是唯一不需要 cgo
//     綁定 C 函式庫的做法。存到 <輸出資料夾>/<檔名>.webp。
//   - LLM 判讀用輸出：另外縮到最長邊不超過 llmPreviewMaxDim（512px，
//     多數視覺 API 的常用下限），存成 JPEG（多數視覺 API 最普遍接受的
//     格式，不需要額外處理 WebP 支援度問題），放在
//     <輸出資料夾>/llm-preview/<檔名>.jpg——用途是給 LLM 快速讀取判斷
//     圖片內容（例如辨識景點/建築物），不是給使用者瀏覽,故用較低的
//     maxDim,換取更快的傳輸與更低的 token/頻寬成本。
//   - 縮圖用 Go 標準庫自己實作雙線性內插（見 resize.go）——沒有用
//     golang.org/x/image/draw,因為這台機器的網路環境連不上
//     proxy.golang.org（TLS 被攔截）,無法下載任何第三方套件,故整支
//     工具刻意零相依,只用標準庫 + 呼叫外部 cwebp 執行檔。
//
// 非圖片檔案（例如手機直出的 .MOV 原況照片影片）不處理，直接跳過。
package main

import (
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	maxDim            = 1600 // 網頁用輸出圖片最長邊上限（px）
	quality           = 80   // cwebp 畫質（0-100）
	llmPreviewMaxDim  = 512  // LLM 判讀用縮圖最長邊上限（px）
	llmPreviewQuality = 70   // LLM 判讀用縮圖畫質——只需要能辨識內容,不需要高畫質
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "用法：%s <輸入資料夾> [輸出資料夾]\n", os.Args[0])
		os.Exit(1)
	}
	inDir := os.Args[1]
	outDir := filepath.Join(inDir, "webp-output")
	if len(os.Args) >= 3 {
		outDir = os.Args[2]
	}

	if _, err := exec.LookPath("cwebp"); err != nil {
		fmt.Fprintln(os.Stderr, "錯誤：找不到 cwebp，請先執行：brew install webp")
		os.Exit(1)
	}

	entries, err := os.ReadDir(inDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "錯誤：讀取輸入資料夾失敗：%v\n", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "錯誤：建立輸出資料夾失敗：%v\n", err)
		os.Exit(1)
	}
	llmPreviewDir := filepath.Join(outDir, "llm-preview")
	if err := os.MkdirAll(llmPreviewDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "錯誤：建立 llm-preview 資料夾失敗：%v\n", err)
		os.Exit(1)
	}

	tmpDir, err := os.MkdirTemp("", "img2webp-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "錯誤：建立暫存資料夾失敗：%v\n", err)
		os.Exit(1)
	}
	defer os.RemoveAll(tmpDir)

	var (
		converted, skipped    int
		totalInSize, totalOut int64
	)

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue // 非圖片檔案（如 .MOV）直接跳過，不是錯誤。
		}

		srcPath := filepath.Join(inDir, name)
		baseName := strings.TrimSuffix(name, filepath.Ext(name))
		outPath := filepath.Join(outDir, baseName+".webp")
		llmPreviewPath := filepath.Join(llmPreviewDir, baseName+".jpg")

		inSize, outSize, err := convertOne(srcPath, outPath, llmPreviewPath, tmpDir, baseName, ext)
		if err != nil {
			fmt.Fprintf(os.Stderr, "跳過（%v）：%s\n", err, name)
			skipped++
			continue
		}

		converted++
		totalInSize += inSize
		totalOut += outSize
		fmt.Printf("%-28s %6.1fMB -> %5.1fMB\n", name, mb(inSize), mb(outSize))
	}

	fmt.Println("---")
	if converted == 0 {
		fmt.Println("沒有任何圖片被轉檔（找不到 .jpg/.jpeg/.png，或全部失敗）。")
		return
	}
	savedPct := 0.0
	if totalInSize > 0 {
		savedPct = (1 - float64(totalOut)/float64(totalInSize)) * 100
	}
	fmt.Printf("完成：%d 張成功，%d 張跳過。總大小 %.1fMB -> %.1fMB（省下 %.1f%%）\n",
		converted, skipped, mb(totalInSize), mb(totalOut), savedPct)
	fmt.Printf("輸出位置：%s\n", outDir)
}

// convertOne 處理單一檔案：解碼 -> 依 EXIF 方向校正 -> 產生兩組獨立的
// 縮圖——網頁用（等比例縮到 maxDim，暫存 JPEG 後呼叫 cwebp 編碼成
// WebP）與 LLM 判讀用（等比例縮到 llmPreviewMaxDim，直接寫成 JPEG）。
// 只解碼原始檔案一次，兩組縮圖各自獨立從同一份已校正方向的像素資料
// 縮放，不會互相影響彼此的畫質。回傳原始檔案大小與網頁版輸出檔案
// 大小，供呼叫端統計總體壓縮效果（LLM 預覽圖不計入這個統計，那是
// 附加產物，不是這個工具的主要壓縮目的）。
func convertOne(srcPath, outPath, llmPreviewPath, tmpDir, baseName, ext string) (inSize, outSize int64, err error) {
	srcInfo, err := os.Stat(srcPath)
	if err != nil {
		return 0, 0, fmt.Errorf("讀取檔案資訊失敗: %w", err)
	}
	inSize = srcInfo.Size()

	f, err := os.Open(srcPath)
	if err != nil {
		return inSize, 0, fmt.Errorf("開啟檔案失敗: %w", err)
	}
	defer f.Close()

	var img image.Image
	switch ext {
	case ".png":
		img, err = png.Decode(f)
	default: // .jpg / .jpeg
		img, err = jpeg.Decode(f)
	}
	if err != nil {
		return inSize, 0, fmt.Errorf("解碼失敗: %w", err)
	}

	// EXIF Orientation 校正——手機直出的直式照片常常實際像素資料是橫躺
	// 儲存、靠 EXIF 的 Orientation 欄位標記「顯示時要轉幾度」，image/jpeg
	// 的標準解碼不會套用這個欄位（Go 標準庫刻意不處理 EXIF），不校正的話
	// 轉出來的 WebP 在多數看圖軟體會是橫躺的。orientation.go 另外讀一次
	// 檔案的 EXIF 段落取得這個值。
	if ext != ".png" {
		if orientation := readOrientation(srcPath); orientation != 1 {
			img = applyOrientation(img, orientation)
		}
	}

	// LLM 判讀用縮圖——獨立從同一份已校正方向的 img 縮放，跟網頁版
	// resized 互不影響（各自算各自的等比例縮放結果），寫成 JPEG 即可，
	// 不需要經過 cwebp（多數視覺 API 對 WebP 的支援度不如 JPEG/PNG
	// 普遍，這組輸出的目的是給模型讀取，不是給瀏覽器顯示，沒有理由
	// 也選擇 WebP）。這一步失敗不影響主要的網頁版輸出——見下方錯誤
	// 處理只印警告、不 return error。
	llmPreview := resizeToMaxDim(img, llmPreviewMaxDim)
	if err := writeJPEGWithQuality(llmPreviewPath, llmPreview, llmPreviewQuality); err != nil {
		fmt.Fprintf(os.Stderr, "警告：LLM 預覽圖產生失敗（不影響網頁版輸出）: %v: %s\n", err, baseName)
	}

	resized := resizeToMaxDim(img, maxDim)

	tmpPath := filepath.Join(tmpDir, baseName+".jpg")
	if err := writeJPEG(tmpPath, resized); err != nil {
		return inSize, 0, fmt.Errorf("寫入暫存檔失敗: %w", err)
	}

	cmd := exec.Command("cwebp", "-q", fmt.Sprintf("%d", quality), "-quiet", tmpPath, "-o", outPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		return inSize, 0, fmt.Errorf("cwebp 轉檔失敗: %v: %s", err, strings.TrimSpace(string(out)))
	}

	outInfo, err := os.Stat(outPath)
	if err != nil {
		return inSize, 0, fmt.Errorf("讀取輸出檔案資訊失敗: %w", err)
	}
	return inSize, outInfo.Size(), nil
}

// writeJPEG 寫出餵給 cwebp 的中繼檔，畫質固定給高一點（95）避免中繼
// 這一手的破壞性壓縮拖累最終 WebP 的畫質——真正的壓縮強度由 cwebp 的
// quality 常數決定。
func writeJPEG(path string, img image.Image) error {
	return writeJPEGWithQuality(path, img, 95)
}

// writeJPEGWithQuality 寫出指定畫質的 JPEG——LLM 預覽圖用這個直接控制
// 畫質（llmPreviewQuality），不像 writeJPEG 那樣固定給高畫質中繼檔。
func writeJPEGWithQuality(path string, img image.Image, quality int) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return jpeg.Encode(f, img, &jpeg.Options{Quality: quality})
}

func mb(bytes int64) float64 {
	return float64(bytes) / (1024 * 1024)
}
