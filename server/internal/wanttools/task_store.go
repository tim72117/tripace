package wanttools

import (
	"fmt"
	"sort"
	"sync"
)

// Task 是 agent 規劃多步驟任務時的單一步驟(存於記憶體,per-channel)。
type Task struct {
	ID   int    `json:"id"`             // 頻道內遞增序號,供 update/complete 指定
	Text string `json:"text"`           // 步驟描述
	Done bool   `json:"done"`           // 是否已完成
	Date string `json:"date,omitempty"` // 絕對日期 'YYYY-MM-DD',留空表示不指定日期
	Kind string `json:"kind,omitempty"` // 這一步屬於新增或更新:'add' | 'update',留空表示不分類
}

// TaskInput 是新增/更新任務時的欄位輸入(text 必填,date/kind 選填)。
// 用結構體而非逐一參數,讓之後要加欄位時不必再改動 Create/Update 的呼叫端。
type TaskInput struct {
	Text string
	Date string
	Kind string
}

// taskStore 是 per-channel 的記憶體任務清單。
// agent 規劃的步驟是「這次工作的計畫」,不需持久化到 DB,server 重啟即清空。
// 並發安全:want agent 可能並行處理,以 mutex 保護。
type taskStore struct {
	mu     sync.Mutex
	byChan map[string][]*Task // channelID → 任務清單
	nextID map[string]int     // channelID → 下一個任務序號
}

var tasks = &taskStore{
	byChan: map[string][]*Task{},
	nextID: map[string]int{},
}

// Create 新增一筆任務,回傳新任務。
func (s *taskStore) Create(channelID string, in TaskInput) *Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createLocked(channelID, in)
}

// CreateMany 一次新增多筆任務(整個計畫一次寫入),回傳新增的任務清單。
func (s *taskStore) CreateMany(channelID string, inputs []TaskInput) []Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Task, 0, len(inputs))
	for _, in := range inputs {
		out = append(out, *s.createLocked(channelID, in))
	}
	return out
}

// createLocked 在已持鎖的情況下新增一筆(供 Create / CreateMany 共用)。
func (s *taskStore) createLocked(channelID string, in TaskInput) *Task {
	s.nextID[channelID]++
	t := &Task{ID: s.nextID[channelID], Text: in.Text, Done: false, Date: in.Date, Kind: in.Kind}
	s.byChan[channelID] = append(s.byChan[channelID], t)
	return t
}

// List 回傳該頻道的任務清單(依 ID 排序的複本,呼叫端不可改動內部狀態)。
func (s *taskStore) List(channelID string) []Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	src := s.byChan[channelID]
	out := make([]Task, 0, len(src))
	for _, t := range src {
		out = append(out, *t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Update 改任務欄位;只更新 in 裡非空的欄位(留空表示不修改,與 entry_update 慣例一致)。
// 找不到該 ID 回 error。
func (s *taskStore) Update(channelID string, id int, in TaskInput) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.byChan[channelID] {
		if t.ID == id {
			if in.Text != "" {
				t.Text = in.Text
			}
			if in.Date != "" {
				t.Date = in.Date
			}
			if in.Kind != "" {
				t.Kind = in.Kind
			}
			return nil
		}
	}
	return fmt.Errorf("task %d not found", id)
}

// Complete 標記任務完成;找不到該 ID 回 error。
func (s *taskStore) Complete(channelID string, id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.byChan[channelID] {
		if t.ID == id {
			t.Done = true
			return nil
		}
	}
	return fmt.Errorf("task %d not found", id)
}

// Delete 刪除單一任務;找不到該 ID 回 error。
func (s *taskStore) Delete(channelID string, id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.byChan[channelID]
	for i, t := range list {
		if t.ID == id {
			s.byChan[channelID] = append(list[:i], list[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("task %d not found", id)
}

// AllDone 回傳該頻道是否所有任務都已完成(空清單視為 false,避免誤判「已全完成」)。
func (s *taskStore) AllDone(channelID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.byChan[channelID]
	if len(list) == 0 {
		return false
	}
	for _, t := range list {
		if !t.Done {
			return false
		}
	}
	return true
}

// Clear 清空該頻道的所有任務與序號。
func (s *taskStore) Clear(channelID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byChan, channelID)
	delete(s.nextID, channelID)
}
