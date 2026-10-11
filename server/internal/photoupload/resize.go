// resize.go——原圖位元組的解析與等比例縮放邏輯,產生 thumbnail/large
// 兩種衍生尺寸(見任務規格:thumbnail 最長邊 400px、large 最長邊
// 1600px)。
//
// 刻意不用任何需要 CGO 的影像函式庫(對齊這個專案選用
// glebarez/sqlite——純 Go 的 SQLite driver——而非標準 CGO sqlite driver
// 的既有原則,見 server/go.mod 的依賴選擇)。解碼用 Go 標準庫
// image/jpeg、image/png、image/webp(標準庫的 image/webp 只能解碼,
// 不能編碼,見下方輸出格式的說明),縮放用 golang.org/x/image/draw
// ——這個套件是官方 x/ 擴充函式庫,純 Go 實作,沒有 CGO 相依。
//
// 輸出格式一律是 JPEG,不是 webp——雖然 webp 檔案通常比 JPEG 小,畫質
// /體積不是這次任務的重點(見任務規格明文:「能動、不依賴 CGO 比較
// 重要」)。純 Go 的 webp 編碼套件(例如 github.com/chai2010/webp)
// 實際上內部仍是透過 cgo 呼叫 libwebp 的 C 實作,並非純 Go,引入它會
// 違背這次任務「不依賴 CGO」的核心原則,因此不採用——直接輸出 JPEG
// 可以完全留在標準庫範圍內,最簡單可靠。
package photoupload

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"

	// image/png 只需要副作用匯入——image.Decode 會依檔頭自動判斷格式
	// 並分派給已註冊的 decoder,這裡只是要讓 PNG decoder 完成 init()
	// 註冊,不需要呼叫這個套件的任何具名函式(編碼輸出一律是 JPEG,
	// 見本檔開頭完整說明)。image/webp 同理,且標準庫沒有對應的編碼
	// 功能可用,底線匯入同樣只為了讓 image.Decode 認得 webp 格式的
	// 原圖。
	_ "image/png"
	_ "golang.org/x/image/webp"

	"golang.org/x/image/draw"
)

// VariantKind 是目前支援的兩種衍生尺寸——對齊 store.photoVariantRow.Kind
// 的裸字串慣例(見該型別完整說明:後端用字串存列舉值,不另外定義
// 型別),這裡仍額外定義具名常數方便這個套件內部與呼叫端(API handler)
// 以符號引用,不等於改變底層儲存/傳遞時用的是裸字串這件事。
const (
	VariantThumbnail = "thumbnail"
	VariantLarge     = "large"
)

// variantMaxEdge 定義各 VariantKind 的最長邊限制(像素)——見任務規格:
// thumbnail 縮圖用,largs 文章內文用。這裡用 map 而非各自獨立常數,
// 讓 GenerateVariants 可以直接迭代這份定義,新增第三種尺寸規格時只
// 需要在這裡加一筆,不需要同時修改迭代邏輯。
var variantMaxEdge = map[string]int{
	VariantThumbnail: 400,
	VariantLarge:     1600,
}

// DecodedImage 是解析原圖後的結果——寬高與可重複使用的 image.Image
// 解碼結果,供 GenerateVariants 進一步縮放,也供呼叫端(API handler)
// 直接取得原圖寬高寫回 store.uploadedPhotoRow.Width/Height(見該型別
// 完整說明:寬高要等這個解析階段才會知道)。
type DecodedImage struct {
	Img    image.Image
	Width  int
	Height int
}

// DecodeImage 解析原圖位元組,回傳寬高與解碼結果——contentType 目前
// 僅作為錯誤訊息的輔助資訊,實際解碼派送交給 image.Decode 依檔案本身
// 的魔術位元組自動判斷格式(比起只信任呼叫端宣告的 Content-Type 更
// 可靠,使用者端瀏覽器回報的 MIME type 不一定準確)。
func DecodeImage(data []byte, contentType string) (DecodedImage, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return DecodedImage{}, fmt.Errorf("解析圖片失敗(contentType=%s): %w", contentType, err)
	}
	bounds := img.Bounds()
	return DecodedImage{Img: img, Width: bounds.Dx(), Height: bounds.Dy()}, nil
}

// GeneratedVariant 是縮放完成的單一衍生版本——Kind/Width/Height/Data
// 供呼叫端分別寫入 store.CreatePhotoVariant 的對應參數、以及上傳到
// GCS 的位元組內容。
type GeneratedVariant struct {
	Kind   string
	Width  int
	Height int
	Data   []byte
}

// GenerateVariants 依 variantMaxEdge 定義的規格,把已解碼的原圖等比例
// 縮放成 thumbnail/large 兩種版本——不裁切(裁切是另一層,由
// FocalX/FocalY + 前端 CSS object-position 處理,見任務規格與
// uploadedPhotoRow.FocalX 的完整說明,這裡產生的 variant 本身永遠是
// 完整等比例縮放的圖)。
//
// 原圖本身小於目標最長邊時不放大——統一都呼叫 scaleToFit 讓它自然
// 處理「目標尺寸比原圖大就不縮放,直接使用原圖尺寸」這個情況(見該
// 函式的完整說明),不需要在這裡另外寫一次條件判斷分流兩種路徑——
// 這樣不論「原圖比目標大」或「原圖比目標小」都走同一條程式碼路徑,
// 少一種需要分別測試的分支組合。
func GenerateVariants(decoded DecodedImage) ([]GeneratedVariant, error) {
	out := make([]GeneratedVariant, 0, len(variantMaxEdge))
	// 固定依 thumbnail→large 的順序產生(map 走訪順序不保證穩定),
	// 讓呼叫端/測試看到的結果順序可預期,也讓之後若此處要印 log 時
	// 輸出順序穩定好讀。
	for _, kind := range []string{VariantThumbnail, VariantLarge} {
		maxEdge := variantMaxEdge[kind]
		scaled, w, h, err := scaleToFit(decoded.Img, decoded.Width, decoded.Height, maxEdge)
		if err != nil {
			return nil, fmt.Errorf("縮放 %s 版本失敗: %w", kind, err)
		}
		data, err := encodeJPEG(scaled)
		if err != nil {
			return nil, fmt.Errorf("編碼 %s 版本失敗: %w", kind, err)
		}
		out = append(out, GeneratedVariant{Kind: kind, Width: w, Height: h, Data: data})
	}
	return out, nil
}

// scaleToFit 把 img(寬 srcW、高 srcH)等比例縮放到最長邊不超過
// maxEdge——srcW/srcH 已經小於等於 maxEdge 時直接回傳原圖本身(不放大,
// 見任務規格明文:原圖本身小於目標尺寸時,不需要產生一個「放大版」,
// 直接用原圖尺寸即可),避免小圖被不必要地放大、徒增模糊的衍生版本
// 卻沒有實際畫質可用。
//
// srcW <= 0 || srcH <= 0 時回傳明確的 error,不嘗試計算縮放比例——
// 原本的計算式(float64(srcH) * float64(maxEdge) / float64(srcW),或
// 反向的寬/高版本)在來源寬或高是 0 時會算出 +Inf,而下方「至少保留
// 1px」的防呆只檢查 dstW < 1,+Inf 並不小於 1,攔不住這個異常輸入,
// 會讓 image.NewRGBA 嘗試用 +Inf 轉成 int 的結果(未定義行為,實務上
// 是一個巨大或負數的值)建立畫布,產生看似正常實則錯誤的輸出,而非
// 明確地失敗。DecodeImage 解析出的寬高理論上不該是 0(image.Decode
// 成功時,bounds.Dx()/Dy() 對正常圖片格式不會是 0),但這裡仍防禦性
// 地檢查,把「異常輸入」轉成呼叫端(GenerateVariants→processUploadedPhoto)
// 既有的失敗處理路徑(回傳 error,讓上層標記這筆照片處理失敗),而不是
// 讓一個明顯異常的輸入被靜默吞掉、產生一張內容無效的衍生圖。
func scaleToFit(img image.Image, srcW, srcH, maxEdge int) (image.Image, int, int, error) {
	if srcW <= 0 || srcH <= 0 {
		return nil, 0, 0, fmt.Errorf("scaleToFit: 來源圖片寬高無效(srcW=%d, srcH=%d)", srcW, srcH)
	}
	if srcW <= maxEdge && srcH <= maxEdge {
		return img, srcW, srcH, nil
	}
	dstW, dstH := srcW, srcH
	if srcW >= srcH {
		dstW = maxEdge
		dstH = int(float64(srcH) * float64(maxEdge) / float64(srcW))
	} else {
		dstH = maxEdge
		dstW = int(float64(srcW) * float64(maxEdge) / float64(srcH))
	}
	// 等比例計算可能因四捨五入誤差讓某一邊變成 0(極端長寬比的圖片)
	// ——至少保留 1px,避免產生一張沒有任何像素的無效圖片。
	if dstW < 1 {
		dstW = 1
	}
	if dstH < 1 {
		dstH = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	// draw.CatmullRom 是品質較高的縮放演算法(雙三次內插的一種),用於
	// 「使用者上傳的原創配圖」這種值得花一點運算成本換取畫質的情境;
	// 對齊 golang.org/x/image/draw 官方文件推薦的縮圖品質選擇(相對於
	// draw.ApproxBiLinear 這種追求速度、犧牲畫質的選項)。這裡的圖片
	// 數量/頻率(使用者手動上傳文章配圖)遠低於需要極致效能的即時轉檔
	// 情境,不需要為了省下的運算時間犧牲畫質。
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Over, nil)
	return dst, dstW, dstH, nil
}

// encodeJPEG 把 image.Image 編碼成 JPEG 位元組——統一的輸出格式,理由
// 見本檔開頭完整說明。品質值 90 是常見的「肉眼難以分辨壓縮痕跡、檔案
// 大小仍有感縮減」折衷值(JPEG 預設的 75 相對明顯損失畫質,100 則幾乎
// 不壓縮、檔案過大),沒有實際使用量數據佐證,日後可依實務回報的檔案
// 大小/畫質需求調整。
//
// RGBA 來源(scaleToFit 縮放後的結果)若帶有透明像素,JPEG 格式本身
// 不支援 alpha 通道,image/jpeg 套件會自動以不透明處理(忽略 alpha、
// 保留 RGB)——這裡不另外處理透明背景合成,使用者上傳的部落格配圖
// 預期以不透明的相片為主,PNG 透明背景圖片轉 JPEG 後背景變黑/白的
// 邊緣情況留待之後有實際需求再處理。
func encodeJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
