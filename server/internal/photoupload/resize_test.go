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
