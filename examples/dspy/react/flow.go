package main

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// flowNodeKind 對應 flow.mmd 開頭註解約定的四種節點形狀。
type flowNodeKind int

const (
	flowNodeStart flowNodeKind = iota
	flowNodeDecision
	flowNodeTool
	flowNodeEnd
)

type flowNode struct {
	id    string
	kind  flowNodeKind
	label string
}

// flowPath 是從起點走到某個終點的一條完整路徑——對應一組訓練/評估資料
// 「該有的行為規格」:預期呼叫哪些工具(依路徑上經過工具節點的順序)、
// 終點節點解析出的預期關鍵字。ID 是路徑上依序經過的節點 id 串接
// (用 "->" 分隔),data.go 用這個字串當 key,把具體中文例句連結到
// 對應的路徑上——同一條路徑的行為規格可以對應多個不同例句(見
// reactExample.pathID 的說明)。
type flowPath struct {
	id            string
	nodeIDs       []string
	tools         []string
	expectKeyword string
}

// parseFlowFile 讀取 .mmd 檔案並展開成所有起點到終點的路徑。這是個刻意
// 寫得很小的 parser——只認 flow.mmd 開頭註解約定的四種節點形狀跟
// "A --> B"/"A -->|label| B" 這兩種邊語法,不是通用的 Mermaid 解析器,
// 圖再複雜(例如迴圈)這支 parser 不保證處理得對。
//
// 支援多起點(多個 ([...]) 形狀節點):對每個起點各自做一次 DFS 展開,
// 結果路徑合併回同一個 []flowPath——用在像 flow_trip_action.mmd 這種
// 「已知意圖」分開畫成多個獨立入口的圖,不需要為了湊單一起點而畫一個
// 純文件用途的分流決策節點。
func parseFlowFile(path string) ([]flowPath, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("開啟 %s: %w", path, err)
	}
	defer f.Close()

	nodes := map[string]flowNode{}
	var nodeOrder []string // 節點 id 依檔案裡首次出現的順序,供多起點時穩定排序用
	edges := map[string][]string{} // fromID -> []toID(依檔案裡出現順序)

	// nodeDefRe 抓「node_id + 形狀括號 + 標籤」——依序嘗試四種形狀,
	// 順序有講究:((...)) 跟 [[...]] 都以 [ 或 ( 開頭,必須先比對雙符號
	// 版本,否則 [[...]] 會被 [...] 的樣式誤吃到一個右括號當標籤結尾。
	//
	// 故意不加 "^" 錨定行首:一行常常同時定義邊的兩端節點(如
	// "classify -->|查詢| callEntryQuery[[entry_query]]" 這行,若
	// classify 是在别行定義的決策節點,這行只定義了 callEntryQuery 一個
	// 新節點;但也有 "A(...) --> B{...}" 這種一行定義兩個新節點的情況)
	// ——用 FindAllStringSubmatch 掃描整行任何位置,才能抓到不在行首的
	// 節點定義。
	nodeDefRes := []struct {
		kind flowNodeKind
		re   *regexp.Regexp
	}{
		{flowNodeStart, regexp.MustCompile(`(\w+)\(\[(.+?)\]\)`)},
		{flowNodeTool, regexp.MustCompile(`(\w+)\[\[(.+?)\]\]`)},
		{flowNodeEnd, regexp.MustCompile(`(\w+)\(\((.+?)\)\)`)},
		{flowNodeDecision, regexp.MustCompile(`(\w+)\{(.+?)\}`)},
	}
	// edgeRe 抓 "A --> B" 或 "A -->|label| B"(label 目前只作文件用途,
	// parser 不解析語意、不影響路徑展開)。
	edgeRe := regexp.MustCompile(`^(\w+)(?:\(\[.+?\]\)|\[\[.+?\]\]|\(\(.+?\)\)|\{.+?\})?\s*-->\s*(?:\|.*?\|\s*)?(\w+)(?:\(\[.+?\]\)|\[\[.+?\]\]|\(\(.+?\)\)|\{.+?\})?`)

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "%%") || strings.HasPrefix(line, "flowchart") {
			continue
		}

		// 節點定義:一行裡可能同時定義節點(第一次出現)並接一條邊
		// (如 "start([收到一句話]) --> hasLocation{有明確地點?}"),
		// 故節點解析跟邊解析分開跑,不互斥。
		for _, def := range nodeDefRes {
			for _, m := range def.re.FindAllStringSubmatch(line, -1) {
				id := m[1]
				if _, exists := nodes[id]; !exists {
					nodes[id] = flowNode{id: id, kind: def.kind, label: m[2]}
					nodeOrder = append(nodeOrder, id)
				}
			}
		}

		if m := edgeRe.FindStringSubmatch(line); m != nil {
			from, to := m[1], m[2]
			edges[from] = append(edges[from], to)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("讀取 %s: %w", path, err)
	}

	// 依檔案裡出現順序收集所有起點——map 遍歷順序不固定,若直接對
	// map[string]flowNode 迭代收集,同一份檔案兩次執行的路徑順序會不
	// 一致(不影響正確性,但不利於輸出穩定、方便比對),故改成再掃一次
	// scanner 讀進來的節點定義順序;這裡簡化做法是改記錄節點出現順序。
	var startIDs []string
	for _, id := range nodeOrder {
		if nodes[id].kind == flowNodeStart {
			startIDs = append(startIDs, id)
		}
	}
	if len(startIDs) == 0 {
		return nil, fmt.Errorf("%s 沒有起點節點(([...]) 形狀)", path)
	}

	var paths []flowPath
	var walk func(id string, nodeIDs []string, tools []string)
	walk = func(id string, nodeIDs []string, tools []string) {
		node, ok := nodes[id]
		if !ok {
			return // 邊指到未定義的節點,忽略(容錯,不視為致命錯誤)
		}
		nodeIDs = append(nodeIDs, id)
		if node.kind == flowNodeTool {
			tools = append(tools, node.label)
		}
		if node.kind == flowNodeEnd {
			keyword := strings.TrimPrefix(node.label, "回覆:")
			paths = append(paths, flowPath{
				id:            strings.Join(nodeIDs, "->"),
				nodeIDs:       append([]string{}, nodeIDs...),
				tools:         append([]string{}, tools...),
				expectKeyword: keyword,
			})
			return
		}
		for _, next := range edges[id] {
			walk(next, nodeIDs, tools)
		}
	}
	for _, startID := range startIDs {
		walk(startID, nil, nil)
	}

	if len(paths) == 0 {
		return nil, fmt.Errorf("%s 沒有找到任何起點到終點的路徑", path)
	}
	return paths, nil
}

// pathsByID 把 []flowPath 轉成 map,供 data.go 的 reactExample.pathID
// 查表對應到該例句該有的行為規格(tools、expectKeyword)。
func pathsByID(paths []flowPath) map[string]flowPath {
	m := make(map[string]flowPath, len(paths))
	for _, p := range paths {
		m[p.id] = p
	}
	return m
}

// matchPathByTools 拿一次實際執行(ReAct trace)依序呼叫過的工具名稱,
// 反查 flow.mmd 展開出的所有路徑,找出「工具呼叫序列完全相符」的那一條
// ——這才是動態判斷「這次執行走的是哪條路徑」,而不是預先信任例句生成
// 時綁定的 pathID。分岔越多、輸入本身越模糊時,例句生成當下標記的
// pathID 只代表「請 LLM 生成時預期它會怎麼分類」,不保證 agent 實際執行
// 時真的走那條路——這個函式驗的是「agent 實際做的事,對應到 flow.mmd
// 裡哪條合法路徑」,若一條都對不上,回傳的第二個值是 false。
//
// 目前每個決策點只留下唯一分支(只認工具呼叫序列,不看決策節點怎麼標
// 籤),所以「工具序列」還無法唯一定位路徑時(例如兩條路徑呼叫的工具
// 序列完全相同,只差在其他決策節點),這個函式會回傳它找到的第一條
// 相符路徑——這是目前 flow.mmd 只有一個決策點時的合理簡化,圖形變複雜
// (多個決策點、序列可能撞名)時需要一併把決策節點的判斷依據也記錄進
// trace 才能唯一定位。
func matchPathByTools(paths []flowPath, calledTools []string) (flowPath, bool) {
	for _, p := range paths {
		if toolSequenceEqual(p.tools, calledTools) {
			return p, true
		}
	}
	return flowPath{}, false
}

func toolSequenceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
