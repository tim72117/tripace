package photoupload

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

// makeTestJPEG 產生一張 w x h、純色填滿的測試用 JPEG 位元組——不需要
// 真實照片內容,縮放/解析邏輯只關心尺寸與格式是否正確處理。
func makeTestJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	fill := color.RGBA{R: 100, G: 150, B: 200, A: 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, fill)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode test jpeg: %v", err)
	}
	return buf.Bytes()
}

// TestDecodeImage_解析出正確寬高 驗證 DecodeImage 能正確解析 JPEG 並
// 回報寬高。
func TestDecodeImage_解析出正確寬高(t *testing.T) {
	data := makeTestJPEG(t, 800, 600)
	decoded, err := DecodeImage(data, "image/jpeg")
	if err != nil {
		t.Fatalf("DecodeImage: %v", err)
	}
	if decoded.Width != 800 || decoded.Height != 600 {
		t.Fatalf("寬高不符,got %dx%d, want 800x600", decoded.Width, decoded.Height)
	}
}

// TestGenerateVariants_等比例縮放且不裁切 驗證原圖比目標尺寸大時,
// thumbnail/large 兩種版本都正確依最長邊限制等比例縮放,長寬比不變
// (不裁切)。
func TestGenerateVariants_等比例縮放且不裁切(t *testing.T) {
	// 2000x1000,長寬比 2:1——大於 thumbnail(400px)與 large(1600px)
	// 兩種限制,兩者都應該觸發縮放。
	decoded := DecodedImage{
		Img:    image.NewRGBA(image.Rect(0, 0, 2000, 1000)),
		Width:  2000,
		Height: 1000,
	}
	variants, err := GenerateVariants(decoded)
	if err != nil {
		t.Fatalf("GenerateVariants: %v", err)
	}
	if len(variants) != 2 {
		t.Fatalf("預期產生 2 個 variant,got %d", len(variants))
	}

	byKind := map[string]GeneratedVariant{}
	for _, v := range variants {
		byKind[v.Kind] = v
	}

	thumb, ok := byKind[VariantThumbnail]
	if !ok {
		t.Fatalf("缺少 thumbnail variant")
	}
	// 2000x1000 長寬比 2:1,最長邊(寬)限制 400 → 400x200。
	if thumb.Width != 400 || thumb.Height != 200 {
		t.Fatalf("thumbnail 尺寸不符,got %dx%d, want 400x200", thumb.Width, thumb.Height)
	}
	if len(thumb.Data) == 0 {
		t.Fatalf("thumbnail 位元組內容不應為空")
	}

	large, ok := byKind[VariantLarge]
	if !ok {
		t.Fatalf("缺少 large variant")
	}
	// 最長邊限制 1600 → 1600x800。
	if large.Width != 1600 || large.Height != 800 {
		t.Fatalf("large 尺寸不符,got %dx%d, want 1600x800", large.Width, large.Height)
	}
}

// TestGenerateVariants_原圖小於目標尺寸不放大 驗證原圖本身小於
// thumbnail/large 的最長邊限制時,不會把圖片放大,直接使用原圖尺寸。
func TestGenerateVariants_原圖小於目標尺寸不放大(t *testing.T) {
	// 300x200——小於 thumbnail 的 400px 限制,也小於 large 的 1600px
	// 限制,兩種 variant 都不該放大。
	decoded := DecodedImage{
		Img:    image.NewRGBA(image.Rect(0, 0, 300, 200)),
		Width:  300,
		Height: 200,
	}
	variants, err := GenerateVariants(decoded)
	if err != nil {
		t.Fatalf("GenerateVariants: %v", err)
	}
	for _, v := range variants {
		if v.Width != 300 || v.Height != 200 {
			t.Fatalf("%s 不應放大,got %dx%d, want 保持 300x200", v.Kind, v.Width, v.Height)
		}
	}
}

// TestScaleToFit_來源寬或高為0時回傳error而非Inf 驗證 scaleToFit 在
// srcW 或 srcH 為 0 時(異常輸入,正常情況下 image.Decode 成功時不會
// 出現,但仍要防禦性處理),正確回傳 error,而不是讓
// float64(x)/float64(0) 算出 +Inf 繼續往下跑、產生一個看似正常實則
// 無效的輸出(+Inf 不會被下方「dstW < 1 時設為 1」這個防呆攔住,因為
// +Inf 不小於 1)。
func TestScaleToFit_來源寬或高為0時回傳error而非Inf(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	cases := []struct {
		name       string
		srcW, srcH int
	}{
		{"寬為0", 0, 600},
		{"高為0", 800, 0},
		{"寬高皆為0", 0, 0},
		{"寬為負數", -1, 600},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, _, _, err := scaleToFit(img, c.srcW, c.srcH, 400)
			if err == nil {
				t.Fatalf("srcW=%d, srcH=%d 應回傳 error,卻沒有", c.srcW, c.srcH)
			}
		})
	}
}

// TestGenerateVariants_原圖寬高為0時整體回傳error 驗證 GenerateVariants
// 在收到寬高為 0 的 DecodedImage 時,正確把 scaleToFit 的 error 往外傳,
// 讓呼叫端(processUploadedPhoto)走既有的失敗處理路徑(標記這筆照片
// 處理失敗),而不是得到一個內容無效但「看似成功」的結果。
func TestGenerateVariants_原圖寬高為0時整體回傳error(t *testing.T) {
	decoded := DecodedImage{
		Img:    image.NewRGBA(image.Rect(0, 0, 1, 1)),
		Width:  0,
		Height: 0,
	}
	if _, err := GenerateVariants(decoded); err == nil {
		t.Fatalf("寬高為 0 時 GenerateVariants 應回傳 error,卻沒有")
	}
}

// TestGenerateVariants_直式圖片依高度縮放 驗證長寬比反過來(高>寬)時,
// 縮放依高度(較長邊)計算,不是永遠依寬度計算。
func TestGenerateVariants_直式圖片依高度縮放(t *testing.T) {
	// 1000x2000,直式,長寬比 1:2。
	decoded := DecodedImage{
		Img:    image.NewRGBA(image.Rect(0, 0, 1000, 2000)),
		Width:  1000,
		Height: 2000,
	}
	variants, err := GenerateVariants(decoded)
	if err != nil {
		t.Fatalf("GenerateVariants: %v", err)
	}
	for _, v := range variants {
		maxEdge := variantMaxEdge[v.Kind]
		if v.Height != maxEdge {
			t.Fatalf("%s 應依高度縮放到 %d,got height=%d", v.Kind, maxEdge, v.Height)
		}
		wantWidth := maxEdge / 2
		if v.Width != wantWidth {
			t.Fatalf("%s 寬度應等比例縮放為 %d,got %d", v.Kind, wantWidth, v.Width)
		}
	}
}

// makeMarkerImage 產生一張 w x h 的測試圖,四個角落各填不同顏色,方便
// 驗證旋轉/翻轉後每個角落的內容是否搬到了正確的新位置——比起純色圖,
// 這樣才能真正驗證座標映射邏輯是否正確,而不只是驗證尺寸。
//
//	(0,0)左上=紅   (w-1,0)右上=綠
//	(0,h-1)左下=藍 (w-1,h-1)右下=黃
func makeMarkerImage(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	bg := color.RGBA{R: 50, G: 50, B: 50, A: 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, bg)
		}
	}
	img.Set(0, 0, color.RGBA{R: 255, A: 255})          // 左上:紅
	img.Set(w-1, 0, color.RGBA{G: 255, A: 255})         // 右上:綠
	img.Set(0, h-1, color.RGBA{B: 255, A: 255})         // 左下:藍
	img.Set(w-1, h-1, color.RGBA{R: 255, G: 255, A: 255}) // 右下:黃
	return img
}

func sameColor(a, b color.Color) bool {
	ar, ag, ab, aa := a.RGBA()
	br, bg, bb, ba := b.RGBA()
	return ar == br && ag == bg && ab == bb && aa == ba
}

// TestRotateImage_各orientation值把正確角落轉到正確位置 驗證
// rotateImage 對 EXIF Orientation 1~8 每個值的轉換結果——用四角標記圖
// (makeMarkerImage)驗證轉換後每個角落的內容落在預期的新位置,這是
// 直接測試座標映射邏輯本身,不透過真的寫入/讀取 EXIF 位元組(goexif
// 主要設計給讀取用,手寫最小合法 EXIF 區塊的往返測試成本高、且測的
// 其實是 goexif 套件本身而非這裡的轉換邏輯)。
//
// 來源圖固定 3x2(寬>高,左上紅/右上綠/左下藍/右下黃),用這組已知的
// EXIF Orientation 標準定義(https://exiftool.org/TagNames/EXIF.html#Orientation)
// 逐一核對。
func TestRotateImage_各orientation值把正確角落轉到正確位置(t *testing.T) {
	red := color.RGBA{R: 255, A: 255}
	green := color.RGBA{G: 255, A: 255}
	blue := color.RGBA{B: 255, A: 255}
	yellow := color.RGBA{R: 255, G: 255, A: 255}

	tests := []struct {
		name            string
		orientation     int
		wantW, wantH    int
		wantTopLeft     color.Color
		wantTopRight    color.Color
		wantBottomLeft  color.Color
		wantBottomRight color.Color
	}{
		{"1_不旋轉", 1, 3, 2, red, green, blue, yellow},
		{"2_水平翻轉", 2, 3, 2, green, red, yellow, blue},
		{"3_180度", 3, 3, 2, yellow, blue, green, red},
		{"4_垂直翻轉", 4, 3, 2, blue, yellow, red, green},
		// 5~8 旋轉後寬高互換(3x2 -> 2x3)。
		{"6_順時針90度", 6, 2, 3, blue, red, yellow, green},
		{"8_逆時針90度", 8, 2, 3, green, yellow, red, blue},
		// 2026-10 code review 修正:原本 5/7 的期望值對調了(對應
		// rotateImage 本身 case 5/7 的實作在同一次修正裡對調,見該函式
		// 開頭的完整說明)——transpose(5,沿主對角線翻轉)是
		// rotate90(flipV),transverse(7,沿副對角線翻轉)是
		// rotate90(flipH),已用獨立 Python 腳本重新逐像素算過新的期望值
		// (不是手算,避免重蹈最初那次手算出錯的覆轍)。
		{"5_垂直翻轉後順時針90度(transpose)", 5, 2, 3, red, blue, green, yellow},
		{"7_水平翻轉後順時針90度(transverse)", 7, 2, 3, yellow, green, blue, red},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := makeMarkerImage(3, 2)
			got := rotateImage(src, tc.orientation)
			b := got.Bounds()
			if b.Dx() != tc.wantW || b.Dy() != tc.wantH {
				t.Fatalf("尺寸 = %dx%d, want %dx%d", b.Dx(), b.Dy(), tc.wantW, tc.wantH)
			}
			if !sameColor(got.At(b.Min.X, b.Min.Y), tc.wantTopLeft) {
				t.Errorf("左上角顏色不符")
			}
			if !sameColor(got.At(b.Max.X-1, b.Min.Y), tc.wantTopRight) {
				t.Errorf("右上角顏色不符")
			}
			if !sameColor(got.At(b.Min.X, b.Max.Y-1), tc.wantBottomLeft) {
				t.Errorf("左下角顏色不符")
			}
			if !sameColor(got.At(b.Max.X-1, b.Max.Y-1), tc.wantBottomRight) {
				t.Errorf("右下角顏色不符")
			}
		})
	}
}

// TestRotateImage_orientation1不複製畫布 驗證 orientation=1(本來就是
// 正的)時直接回傳原始 img,不重新配置畫布——見 rotateImage 的完整
// 說明:避免無謂的記憶體配置。
func TestRotateImage_orientation1不複製畫布(t *testing.T) {
	src := makeMarkerImage(3, 2)
	got := rotateImage(src, 1)
	if got != image.Image(src) {
		t.Fatalf("orientation=1 應直接回傳原始 img,不應重新配置畫布")
	}
}

// TestRotateImage_未知值不旋轉 驗證不在 1~8 範圍內的值(理論上不會
// 出現)比照「讀不到 EXIF」的既有降級邏輯,原樣回傳不旋轉。
func TestRotateImage_未知值不旋轉(t *testing.T) {
	src := makeMarkerImage(3, 2)
	got := rotateImage(src, 99)
	if got != image.Image(src) {
		t.Fatalf("未知 orientation 值應原樣回傳,不應旋轉")
	}
}

// TestApplyEXIFOrientation_無EXIF資料時原樣回傳 驗證
// applyEXIFOrientation 對沒有 EXIF 區塊的圖片資料(例如這裡用
// makeTestJPEG 產生、未經任何 EXIF 寫入工具處理的純測試圖)原樣回傳,
// 不當成錯誤中斷——見該函式完整說明:這是絕大多數非手機拍攝圖片的
// 正常情況。
func TestApplyEXIFOrientation_無EXIF資料時原樣回傳(t *testing.T) {
	src := makeMarkerImage(3, 2)
	data := makeTestJPEG(t, 3, 2)
	got := applyEXIFOrientation(src, data)
	if got != image.Image(src) {
		t.Fatalf("無 EXIF 資料時應原樣回傳,不應嘗試旋轉")
	}
}
