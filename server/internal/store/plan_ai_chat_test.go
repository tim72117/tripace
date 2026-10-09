package store

import "testing"

// TestListPlanAiChatMessagesEmpty 驗證查無資料時回空陣列(非 nil),對齊
// adminconsole.listPlanAiChatLogs 直接把回傳值丟進 JSON 陣列欄位的假設。
func TestListPlanAiChatMessagesEmpty(t *testing.T) {
	s := newTestStore(t)

	got, err := s.ListPlanAiChatMessages(10)
	if err != nil {
		t.Fatalf("ListPlanAiChatMessages: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("查無資料應回空陣列,卻回 %d 筆", len(got))
	}
}

// TestListPlanAiChatMessagesOrderAndLimit 驗證依 CreatedAt 降冪排序(最新
// 在前)、且 limit 生效(只回傳前 N 筆,不是全部)。
func TestListPlanAiChatMessagesOrderAndLimit(t *testing.T) {
	s := newTestStore(t)

	// 依序寫入 3 筆,insert 順序即建立時間先後(now() 單調遞增)。
	msg1, err := s.InsertPlanAiChatMessage("usr_1", "conv_1", "user", "第一句")
	if err != nil {
		t.Fatalf("insert msg1: %v", err)
	}
	msg2, err := s.InsertPlanAiChatMessage("usr_1", "conv_1", "assistant", "第二句")
	if err != nil {
		t.Fatalf("insert msg2: %v", err)
	}
	msg3, err := s.InsertPlanAiChatMessage("usr_2", "conv_2", "user", "第三句")
	if err != nil {
		t.Fatalf("insert msg3: %v", err)
	}

	// limit 生效:只拿最新 2 筆。
	got, err := s.ListPlanAiChatMessages(2)
	if err != nil {
		t.Fatalf("ListPlanAiChatMessages: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("limit=2 應回 2 筆,卻回 %d 筆", len(got))
	}
	// 降冪排序:最新(msg3)在前,其次 msg2。
	if got[0].ID != msg3.ID {
		t.Fatalf("第一筆應是最新寫入的 msg3(id=%d),卻是 id=%d", msg3.ID, got[0].ID)
	}
	if got[1].ID != msg2.ID {
		t.Fatalf("第二筆應是 msg2(id=%d),卻是 id=%d", msg2.ID, got[1].ID)
	}

	// limit 不限制排序正確性本身:拿全部 3 筆時仍應保持降冪。
	all, err := s.ListPlanAiChatMessages(10)
	if err != nil {
		t.Fatalf("ListPlanAiChatMessages(10): %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("應回全部 3 筆,卻回 %d 筆", len(all))
	}
	if all[0].ID != msg3.ID || all[1].ID != msg2.ID || all[2].ID != msg1.ID {
		t.Fatalf("降冪排序不正確: got ids = [%d, %d, %d]", all[0].ID, all[1].ID, all[2].ID)
	}
}
