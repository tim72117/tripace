package store

import "testing"

// partner_tenant_isolation_test.go——partner/campaign/adPlan 這組新表
// (2026-10 新增,見 entity.go 的 partnerRow/campaignRow/adPlanRow 完整
// 說明)的租戶隔離測試。這是整個 partnerconsole 設計裡風險最高的一塊:
// 每一條 campaign/adPlan 查詢都靠 WHERE partner_id = ?(或
// campaign_id IN (子查詢))手刻隔離條件,沒有資料庫層級的 RLS 或框架
// 保證——任何一條方法漏寫這個條件,就是一個業主能讀到/改到/刪到別的
// 業主資料的真實漏洞,而且不會在型別檢查或一般功能測試裡被抓到(兩個
// 業主各自的資料「看起來」都正常,只有刻意用錯的 partnerID 去查才會
// 暴露問題)。這組測試直接針對這個攻擊面:建兩個業主、各自建資料,
// 確認業主 A 用自己的 ID 永遠查不到/改不到/刪不到業主 B 的東西。

// newTestPartner 建一個測試用業主,UserID 用呼叫端給的字串即可(不需要
// 真的存在對應的 userRow——partnerRow.UserID 沒有外鍵約束,store 層
// 本身不驗證這件事,驗證使用者存在與否是上層 API handler 的責任,見
// handleMaintenancePartnerGrant 的完整說明)。
func newTestPartner(t *testing.T, s *Store, userID, name string) string {
	t.Helper()
	p, err := s.CreatePartner(userID, name)
	if err != nil {
		t.Fatalf("CreatePartner(%s): %v", userID, err)
	}
	return p.ID
}

func TestCampaignTenantIsolation(t *testing.T) {
	s := newTestStore(t)
	partnerA := newTestPartner(t, s, "usr_a", "業主A")
	partnerB := newTestPartner(t, s, "usr_b", "業主B")

	campaignA, err := s.CreateCampaign(partnerA, "業主A的活動", "", "2026-01-01", "2026-12-31")
	if err != nil {
		t.Fatalf("CreateCampaign: %v", err)
	}

	// 業主 B 用自己的 partnerID 查業主 A 的 campaign——必須查不到。
	if _, err := s.GetCampaignForPartner(partnerB, campaignA.ID); err != ErrNotFound {
		t.Fatalf("業主B查業主A的campaign: got err=%v, want ErrNotFound(不應該查得到別人的活動)", err)
	}

	// 業主 B 的列表裡不應該出現業主 A 的活動。
	listB, err := s.ListCampaignsByPartner(partnerB)
	if err != nil {
		t.Fatalf("ListCampaignsByPartner(partnerB): %v", err)
	}
	if len(listB) != 0 {
		t.Fatalf("業主B的活動列表 = %v, want 空列表(不應該看到業主A的活動)", listB)
	}

	// 業主 B 嘗試更新業主 A 的 campaign——必須失敗,且不能真的改到資料。
	if err := s.UpdateCampaignForPartner(partnerB, campaignA.ID, "被業主B惡意改名", "", "", ""); err != ErrNotFound {
		t.Fatalf("業主B更新業主A的campaign: got err=%v, want ErrNotFound", err)
	}
	// 驗證資料真的沒被改到(用業主A自己的身分查回來確認名稱不變)。
	got, err := s.GetCampaignForPartner(partnerA, campaignA.ID)
	if err != nil {
		t.Fatalf("業主A查自己的campaign: %v", err)
	}
	if got.Name != "業主A的活動" {
		t.Fatalf("campaign.Name = %q, want 未被業主B的更新請求改動", got.Name)
	}

	// 業主 B 嘗試轉換業主 A 的 campaign 狀態——必須失敗。
	if err := s.SetCampaignStatusForPartner(partnerB, campaignA.ID, "active"); err != ErrNotFound {
		t.Fatalf("業主B轉換業主A的campaign狀態: got err=%v, want ErrNotFound", err)
	}

	// 業主 B 嘗試刪除業主 A 的 campaign——必須失敗,且活動要還在。
	if err := s.DeleteCampaignForPartner(partnerB, campaignA.ID); err != ErrNotFound {
		t.Fatalf("業主B刪除業主A的campaign: got err=%v, want ErrNotFound", err)
	}
	if _, err := s.GetCampaignForPartner(partnerA, campaignA.ID); err != nil {
		t.Fatalf("業主A的campaign應該仍然存在(未被業主B的刪除請求影響),但查詢失敗: %v", err)
	}

	// 反向確認:業主 A 用自己的身分能正常操作自己的 campaign(排除
	// 「隔離機制把所有查詢都擋死」這種過度修正的可能)。
	if _, err := s.GetCampaignForPartner(partnerA, campaignA.ID); err != nil {
		t.Fatalf("業主A查自己的campaign不應該失敗: %v", err)
	}
	listA, err := s.ListCampaignsByPartner(partnerA)
	if err != nil {
		t.Fatalf("ListCampaignsByPartner(partnerA): %v", err)
	}
	if len(listA) != 1 || listA[0].ID != campaignA.ID {
		t.Fatalf("業主A的活動列表 = %v, want 剛好包含自己的一筆活動", listA)
	}
}

func TestAdPlanTenantIsolation(t *testing.T) {
	s := newTestStore(t)
	partnerA := newTestPartner(t, s, "usr_a", "業主A")
	partnerB := newTestPartner(t, s, "usr_b", "業主B")

	campaignA, err := s.CreateCampaign(partnerA, "業主A的活動", "", "", "")
	if err != nil {
		t.Fatalf("CreateCampaign: %v", err)
	}
	planA, err := s.CreateAdPlanForPartner(partnerA, campaignA.ID, "display", "業主A的方案", "")
	if err != nil {
		t.Fatalf("CreateAdPlanForPartner: %v", err)
	}

	// 業主 B 嘗試在業主 A 的 campaign 底下建方案——必須因為
	// GetCampaignForPartner 的歸屬檢查而失敗(見 CreateAdPlanForPartner
	// 的完整說明:adPlanRow 沒有直接存 PartnerID,靠先驗證 campaign
	// 歸屬間接把關)。
	if _, err := s.CreateAdPlanForPartner(partnerB, campaignA.ID, "display", "業主B想掛在別人活動底下", ""); err != ErrNotFound {
		t.Fatalf("業主B在業主A的campaign底下建方案: got err=%v, want ErrNotFound", err)
	}

	// 業主 B 查業主 A 的方案列表——必須因為 campaign 歸屬檢查失敗
	// (ListAdPlansForPartner 本身也是先驗證 campaign 歸屬)。
	if _, err := s.ListAdPlansForPartner(partnerB, campaignA.ID); err != ErrNotFound {
		t.Fatalf("業主B列出業主A的campaign底下方案: got err=%v, want ErrNotFound", err)
	}

	// 業主 B 嘗試用方案 ID 直接查/改/刪業主 A 的方案(adPlansOwnedByPartner
	// 子查詢是否真的有效把關,而不只是 CreateAdPlanForPartner 那層
	// campaign 檢查有效)。
	if _, err := s.GetAdPlanForPartner(partnerB, planA.ID); err != ErrNotFound {
		t.Fatalf("業主B查業主A的plan(by ID): got err=%v, want ErrNotFound", err)
	}
	if err := s.UpdateAdPlanForPartner(partnerB, planA.ID, "display", "被業主B惡意改名", ""); err != ErrNotFound {
		t.Fatalf("業主B更新業主A的plan: got err=%v, want ErrNotFound", err)
	}
	if err := s.SetAdPlanStatusForPartner(partnerB, planA.ID, "published"); err != ErrNotFound {
		t.Fatalf("業主B轉換業主A的plan狀態: got err=%v, want ErrNotFound", err)
	}
	if err := s.DeleteAdPlanForPartner(partnerB, planA.ID); err != ErrNotFound {
		t.Fatalf("業主B刪除業主A的plan: got err=%v, want ErrNotFound", err)
	}

	// 驗證業主 A 的方案真的完全沒被業主 B 的這些請求影響過。
	got, err := s.GetAdPlanForPartner(partnerA, planA.ID)
	if err != nil {
		t.Fatalf("業主A查自己的plan: %v", err)
	}
	if got.Title != "業主A的方案" || got.Status != "draft" {
		t.Fatalf("plan = %+v, want Title/Status 都未被業主B的請求改動", got)
	}

	// 反向確認:業主 A 用自己的身分能正常操作自己的方案。
	if err := s.SetAdPlanStatusForPartner(partnerA, planA.ID, "published"); err != nil {
		t.Fatalf("業主A轉換自己的plan狀態不應該失敗: %v", err)
	}
}

// TestCreatePartnerDuplicateUserID 驗證同一個 userID 不能被授予兩次
// 業主身分(partnerRow.UserID 的 uniqueIndex 語意)——對應
// handleMaintenancePartnerGrant 用 ErrAlreadyExists 回 409 的呼叫端
// 行為依據。
func TestCreatePartnerDuplicateUserID(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.CreatePartner("usr_dup", "第一次授予"); err != nil {
		t.Fatalf("CreatePartner(第一次): %v", err)
	}
	if _, err := s.CreatePartner("usr_dup", "第二次授予"); err != ErrAlreadyExists {
		t.Fatalf("CreatePartner(重複userID): got err=%v, want ErrAlreadyExists", err)
	}
}

// TestFindPartnerByUserIDNotFound 驗證沒有業主身分的 userID 查詢回傳
// ErrNotFound——這是 partnerconsole.withPartner 判斷「這個登入使用者
// 不是業主」的唯一依據,必須明確回傳這個 sentinel error,呼叫端才能
// 正確轉成 401。
func TestFindPartnerByUserIDNotFound(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.FindPartnerByUserID("usr_never_granted"); err != ErrNotFound {
		t.Fatalf("FindPartnerByUserID(未授予業主身分的使用者): got err=%v, want ErrNotFound", err)
	}
}
