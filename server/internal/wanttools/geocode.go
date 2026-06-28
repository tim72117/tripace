package wanttools

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/channel/server/internal/geo"
	"github.com/tim72117/want/types"
)

var GeocodeDeclaration = types.ToolDeclaration{
	Name:        "geocode",
	Description: "查詢地點名稱的經緯度座標。查詢字串應包含城市名以提高準確度（如「宮古島希爾頓酒店」而非僅「希爾頓酒店」）。回傳第一筆最相符的結果。",
	Type:        "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"place": map[string]interface{}{
				"type":        "STRING",
				"description": "地點查詢字串，應包含城市或地區名稱以限制搜尋範圍，例如「宮古島東急飯店」、「東京新宿希爾頓」。",
			},
		},
		"required": []string{"place"},
	},
}

type GeocodeTool struct {
	types.BaseToolConfig
}

func (t *GeocodeTool) Call(args types.ToolArguments, ctx types.ToolContext) ([]types.ResultContentBlock, error) {
	place := args.GetString("place")
	if place == "" {
		return nil, fmt.Errorf("place 不可為空")
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)

	gctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	places, err := client.Search(gctx, place, &geo.SearchOptions{MaxResults: 1})
	if err != nil {
		return nil, fmt.Errorf("geocode 查詢失敗: %w", err)
	}

	p := places[0]
	msg := fmt.Sprintf("📍 %s\n地址：%s\n座標：%.6f, %.6f", p.Name, p.Address, p.Lat, p.Lng)
	ctx.EmitToolResult(map[string]interface{}{
		"name":    p.Name,
		"address": p.Address,
		"lat":     p.Lat,
		"lng":     p.Lng,
	})
	return []types.ResultContentBlock{types.TextBlock(msg)}, nil
}

func (t *GeocodeTool) RenderToolUse(args types.ToolArguments) string {
	return fmt.Sprintf("正在查詢地點「%s」的座標...", args.GetString("place"))
}

func (t *GeocodeTool) RenderToolUseError(err error) string {
	return fmt.Sprintf("地點查詢失敗：%v", err)
}

func (t *GeocodeTool) RenderToolResult(data map[string]interface{}) string {
	name, _ := data["name"].(string)
	address, _ := data["address"].(string)
	lat, _ := data["lat"].(float64)
	lng, _ := data["lng"].(float64)
	return fmt.Sprintf("📍 %s\n%s\n(%.6f, %.6f)", name, address, lat, lng)
}

func init() {
	types.RegisterTool(GeocodeDeclaration, func() types.ToolInterface {
		return &GeocodeTool{}
	})
}
