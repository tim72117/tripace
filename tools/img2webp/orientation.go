package main

import (
	"encoding/binary"
	"image"
	"os"
)

// readOrientation 讀取 JPEG 檔案 EXIF 裡的 Orientation 欄位（TIFF tag
// 0x0112），查不到或解析失敗時回傳 1（代表「不需要旋轉」），不視為
// 錯誤——不是所有 JPEG 都帶 EXIF（例如已經處理過的圖），沒有就當作
// 已經是正的。
//
// 自己手刻最小 TIFF/EXIF 解析，不依賴任何套件（見 main.go 開頭對零
// 相依的完整說明）——只解析找出 Orientation 這一個 tag 需要的最小
// 子集，不是完整的 EXIF 解析器。
func readOrientation(path string) int {
	f, err := os.Open(path)
	if err != nil {
		return 1
	}
	defer f.Close()

	// JPEG 檔案由一串 marker segment 組成，找 APP1（0xFFE1，EXIF 資料
	// 存放的區段）。
	buf := make([]byte, 2)
	if _, err := f.Read(buf); err != nil || buf[0] != 0xFF || buf[1] != 0xD8 {
		return 1 // 不是合法的 JPEG SOI marker。
	}

	for {
		if _, err := f.Read(buf); err != nil {
			return 1
		}
		if buf[0] != 0xFF {
			return 1
		}
		marker := buf[1]
		if marker == 0xD9 || marker == 0xDA { // EOI 或 SOS：EXIF 只會在這之前
			return 1
		}

		lenBuf := make([]byte, 2)
		if _, err := f.Read(lenBuf); err != nil {
			return 1
		}
		segLen := int(binary.BigEndian.Uint16(lenBuf))
		if segLen < 2 {
			return 1
		}

		if marker == 0xE1 { // APP1
			data := make([]byte, segLen-2)
			if _, err := f.Read(data); err != nil {
				return 1
			}
			if o := parseExifOrientation(data); o != 0 {
				return o
			}
			return 1
		}

		// 不是 APP1，跳過整段內容繼續找下一個 marker。
		if _, err := f.Seek(int64(segLen-2), 1); err != nil {
			return 1
		}
	}
}

// parseExifOrientation 解析 APP1 段落內容，找到 Orientation tag 就回傳
// 其值（1-8），找不到回傳 0。
func parseExifOrientation(data []byte) int {
	// APP1 內容開頭是 "Exif\0\0"，之後才是 TIFF header。
	if len(data) < 8 || string(data[0:4]) != "Exif" {
		return 0
	}
	tiff := data[6:]
	if len(tiff) < 8 {
		return 0
	}

	var bo binary.ByteOrder
	switch string(tiff[0:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 0
	}

	ifdOffset := bo.Uint32(tiff[4:8])
	if int(ifdOffset)+2 > len(tiff) {
		return 0
	}

	numEntries := bo.Uint16(tiff[ifdOffset : ifdOffset+2])
	entriesStart := ifdOffset + 2
	const entrySize = 12
	for i := 0; i < int(numEntries); i++ {
		off := int(entriesStart) + i*entrySize
		if off+entrySize > len(tiff) {
			break
		}
		tag := bo.Uint16(tiff[off : off+2])
		if tag == 0x0112 { // Orientation
			valueOffset := off + 8
			return int(bo.Uint16(tiff[valueOffset : valueOffset+2]))
		}
	}
	return 0
}

// applyOrientation 依 EXIF Orientation 值（1-8）把像素資料轉成「正常
// 顯示方向」，對照 EXIF 規範表：
//
//	1 = 不需處理  2 = 水平翻轉  3 = 旋轉180°  4 = 垂直翻轉
//	5 = 轉置(對角線翻轉)  6 = 順時針90°  7 = 反轉置  8 = 逆時針90°
//
// 手機拍照最常見的是 6（直向拍攝時感光元件其實是橫的，相機韌體用這個
// 欄位標記「顯示時要轉 90 度」)。
func applyOrientation(src image.Image, orientation int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()

	switch orientation {
	case 2:
		return flipH(src)
	case 3:
		return rotate180(src)
	case 4:
		return flipV(src)
	case 5:
		return transpose(src)
	case 6:
		return rotate90CW(src)
	case 7:
		return transverse(src)
	case 8:
		return rotate90CCW(src)
	default:
		_ = w
		_ = h
		return src
	}
}

func flipH(src image.Image) image.Image {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			dst.Set(b.Max.X-1-x, y-b.Min.Y, src.At(x, y))
		}
	}
	return dst
}

func flipV(src image.Image) image.Image {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			dst.Set(x-b.Min.X, b.Max.Y-1-y, src.At(x, y))
		}
	}
	return dst
}

func rotate180(src image.Image) image.Image {
	return flipV(flipH(src))
}

func rotate90CW(src image.Image) image.Image {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dy(), b.Dx()))
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			dst.Set(b.Max.Y-1-y, x-b.Min.X, src.At(x, y))
		}
	}
	return dst
}

func rotate90CCW(src image.Image) image.Image {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dy(), b.Dx()))
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			dst.Set(y-b.Min.Y, b.Max.X-1-x, src.At(x, y))
		}
	}
	return dst
}

func transpose(src image.Image) image.Image {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dy(), b.Dx()))
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			dst.Set(y-b.Min.Y, x-b.Min.X, src.At(x, y))
		}
	}
	return dst
}

func transverse(src image.Image) image.Image {
	return rotate180(transpose(src))
}
