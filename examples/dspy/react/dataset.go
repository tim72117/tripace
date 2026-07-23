package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// datasetFile 是 gendata 子命令的輸出、train 子命令的輸入——把「LLM 生成
// 資料」跟「訓練」拆成兩個獨立步驟(兩次 go run .,中間人工看過 JSON 檔
// 再決定要不要繼續),而不是生成完立刻接著訓練。
type datasetFile struct {
	TrainSet []reactExample `json:"trainSet"`
	EvalSet  []reactExample `json:"evalSet"`
}

func saveDataset(path string, d datasetFile) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("建立 %s: %w", path, err)
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(d); err != nil {
		return fmt.Errorf("寫入 %s: %w", path, err)
	}
	return nil
}

func loadDataset(path string) (datasetFile, error) {
	var d datasetFile
	b, err := os.ReadFile(path)
	if err != nil {
		return d, fmt.Errorf("讀取 %s: %w(先執行 \"go run . gendata\" 產生這個檔案)", path, err)
	}
	if err := json.Unmarshal(b, &d); err != nil {
		return d, fmt.Errorf("解析 %s: %w", path, err)
	}
	return d, nil
}
