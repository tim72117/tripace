package main

import (
	"image"
	"image/color"
)

// resizeToMaxDim 等比例縮小圖片，讓最長邊不超過 max（px）。已經比 max
// 小的圖片原樣傳回，不放大——放大只會讓檔案變大、畫質變差，對網頁優化
// 沒有任何幫助。
//
// 用雙線性內插（bilinear interpolation）自己實作，不依賴
// golang.org/x/image/draw——這台機器的網路環境連不上 proxy.golang.org
// 抓不到任何第三方套件（見 main.go 開頭的完整說明），故整支工具只用
// Go 標準庫。雙線性內插是縮圖最常見的插值方式之一（品質介於最近鄰的
// 鋸齒感與雙三次的運算成本之間，對這個工具的用途——網頁縮圖——已經
// 足夠好）。
func resizeToMaxDim(src image.Image, max int) image.Image {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w <= max && h <= max {
		return src
	}

	var newW, newH int
	if w >= h {
		newW = max
		newH = int(float64(h) * float64(max) / float64(w))
	} else {
		newH = max
		newW = int(float64(w) * float64(max) / float64(h))
	}
	if newW < 1 {
		newW = 1
	}
	if newH < 1 {
		newH = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	scaleX := float64(w) / float64(newW)
	scaleY := float64(h) / float64(newH)

	for dy := 0; dy < newH; dy++ {
		srcYf := (float64(dy)+0.5)*scaleY - 0.5
		for dx := 0; dx < newW; dx++ {
			srcXf := (float64(dx)+0.5)*scaleX - 0.5
			dst.Set(dx, dy, bilinearSample(src, bounds, srcXf, srcYf))
		}
	}
	return dst
}

// bilinearSample 在 (x, y)（可為非整數座標）取雙線性內插後的顏色值，
// 座標超出邊界時夾在邊緣（clamp），不做外插或回繞。
func bilinearSample(src image.Image, bounds image.Rectangle, x, y float64) color.Color {
	x0 := int(x)
	y0 := int(y)
	x1 := x0 + 1
	y1 := y0 + 1

	fx := x - float64(x0)
	fy := y - float64(y0)

	x0 = clamp(x0, bounds.Min.X, bounds.Max.X-1)
	x1 = clamp(x1, bounds.Min.X, bounds.Max.X-1)
	y0 = clamp(y0, bounds.Min.Y, bounds.Max.Y-1)
	y1 = clamp(y1, bounds.Min.Y, bounds.Max.Y-1)

	c00 := colorToFloat(src.At(x0, y0))
	c10 := colorToFloat(src.At(x1, y0))
	c01 := colorToFloat(src.At(x0, y1))
	c11 := colorToFloat(src.At(x1, y1))

	r := lerp2D(c00[0], c10[0], c01[0], c11[0], fx, fy)
	g := lerp2D(c00[1], c10[1], c01[1], c11[1], fx, fy)
	b := lerp2D(c00[2], c10[2], c01[2], c11[2], fx, fy)
	a := lerp2D(c00[3], c10[3], c01[3], c11[3], fx, fy)

	return color.RGBA{
		R: uint8(clampFloat(r, 0, 255)),
		G: uint8(clampFloat(g, 0, 255)),
		B: uint8(clampFloat(b, 0, 255)),
		A: uint8(clampFloat(a, 0, 255)),
	}
}

// colorToFloat 把 image/color.Color（16-bit 通道）轉成 0-255 範圍的
// [R, G, B, A] float64 陣列，方便後續內插運算。
func colorToFloat(c color.Color) [4]float64 {
	r, g, b, a := c.RGBA()
	return [4]float64{
		float64(r) / 257, // RGBA() 回傳 16-bit（0-65535），除以 257 還原成 0-255
		float64(g) / 257,
		float64(b) / 257,
		float64(a) / 257,
	}
}

func lerp2D(v00, v10, v01, v11, fx, fy float64) float64 {
	top := v00 + (v10-v00)*fx
	bottom := v01 + (v11-v01)*fx
	return top + (bottom-top)*fy
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
