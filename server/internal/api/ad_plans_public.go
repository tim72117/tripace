// ad_plans_public.go——公開讀取端點(/public/ad-plans),供前台頁面
// (例如 web/src/home/KyotoPage.tsx)顯示業主投放的廣告方案。這是
// partnerconsole(業主自己管理活動/方案的後台)跟一般訪客之間唯一的
// 連接點——partnerconsole 的其餘端點全部要求業主身分,這裡刻意相反
// (不需要任何登入),因為呼叫端是匿名訪客瀏覽主站頁面。
//
// registerAdPlanRoutes 把這個檔案涉及的所有路由註冊收斂到一個函式裡
// (2026-10 新增)——原本 api.go 的 Routes() 把全站所有端點的
// mux.HandleFunc(...) 呼叫全部攤平寫在同一個巨大函式裡,即使 handler
// 本身早就分散在 content_page.go/maintenance.go 等不同檔案,「掛路由」
// 這一步仍然集中在 api.go 一處——代表任何一組新端點要上線,都得去改
// api.go 這同一個檔案的同一個函式,跟其他人同時間在改的別組端點擠在
// 同一批 diff 裡,無法乾淨地獨立 commit(2026-10 code review 時實際
// 遇到:廣告業主系統的路由跟部落格文章系統的路由混在 api.go 同一段
// diff 裡,只能用 git add -p 手動切 hunk)。改成每個領域各自提供一個
// register 函式、定義在自己的檔案裡,api.go 的 Routes() 只負責呼叫,
// 這樣這個領域的路由異動完全侷限在這個檔案內,不會再跟其他領域的
// 路由改動混在同一份 diff 裡。這不是要一次把全站路由都拆成這個模式
// (範圍過大,風險高於現在的實際需求),只先示範在這個最新加入的領域
// 上,之後其他領域要再拆,可以依樣照做。
package api

import (
	"net/http"

	"github.com/tim72117/tripace/internal/model"
)

// registerAdPlanRoutes 掛載廣告業主系統對外曝露的兩類路由:
//   - mux 上的 GET /public/ad-plans(訪客端,見 handlePublicAdPlans)
//   - internalMux 上的 POST /internal/maintenance/partners(CLI 維運端,
//     見 maintenance.go handleMaintenancePartnerGrant)
//
// 兩者雖然掛在不同 mux(對應不同的外層驗證包裝,見 api.go Routes()
// 呼叫處的既有分段),但都屬於同一個「廣告業主系統對外介面」的範疇,
// 收斂進同一個函式/同一個檔案一併管理。
func (s *Server) registerAdPlanRoutes(mux, internalMux *http.ServeMux) {
	// 業主投放的廣告方案(前台頁面,例如 KyotoPage.tsx,依 placement
	// 查詢該頁面要顯示的方案,不需要登入——訪客瀏覽主站頁面本來就是
	// 匿名的)。
	mux.HandleFunc("GET /public/ad-plans", s.handlePublicAdPlans)

	// 業主身分開通——供 tripace-cli 的 partner-grant 指令使用,目前
	// 沒有自助申請流程,只能透過這支端點由內部人員手動開通。
	internalMux.HandleFunc("POST /internal/maintenance/partners", s.handleMaintenancePartnerGrant)
}

type publicAdCampaign struct {
	CampaignID string         `json:"campaignID"`
	Plans      []model.AdPlan `json:"plans"`
}

type publicAdPlansResponse struct {
	Placement string             `json:"placement"`
	Campaigns []publicAdCampaign `json:"campaigns"`
}

// GET /public/ad-plans?placement={頁面slug}
//
// 查詢邏輯分兩步(對齊 store.campaignRow.Placement 的完整說明:這是
// 業主自助控制台最小可行版本的投放機制,單一 placement 字串對應單一
// 頁面,不做多版位/城市/裝置組合條件):
//  1. ListActiveCampaignsByPlacement:找出這個 placement 底下所有
//     status='active' 的活動——只看狀態,不自己判斷檔期日期是否落在
//     StartDate/EndDate 區間內(對齊 campaignRow 的狀態機說明:業主
//     手動控制 active/paused,系統不自動依日期切換)。
//  2. 對每個 active 活動,查詢底下 status='published' 的方案——草稿
//     方案即使活動本身是 active,也不該出現在這裡(業主可能還在
//     編輯方案內容,尚未確認要發布)。
//
// 回傳形狀是「依活動分組的方案列表」而非扁平的方案陣列——即使目前
// 前端(KyotoPage.tsx)只會取第一筆方案渲染,保留分組結構讓之後若
// 同一個 placement 有多個活動同時投放(例如不同業主都選了同一個
// placement)時,前端有完整資訊可以決定怎麼呈現(例如輪播多個活動),
// 不需要之後再改一次回應格式。
func (s *Server) handlePublicAdPlans(w http.ResponseWriter, r *http.Request) {
	placement := r.URL.Query().Get("placement")
	if placement == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 placement 查詢參數")
		return
	}

	campaigns, err := s.store.ListActiveCampaignsByPlacement(placement)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	out := make([]publicAdCampaign, 0, len(campaigns))
	for _, c := range campaigns {
		plans, err := s.store.ListPublishedAdPlansByCampaignID(c.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
			return
		}
		if len(plans) == 0 {
			// 活動是 active,但底下沒有任何已發布的方案——對前台來說
			// 等同沒有東西可顯示,略過這個活動而非回傳一個空方案陣列
			// 的活動物件(避免前端還要多一層判斷「有活動但方案是空的」
			// 這種中繼狀態)。
			continue
		}
		out = append(out, publicAdCampaign{CampaignID: c.ID, Plans: plans})
	}

	writeJSON(w, http.StatusOK, publicAdPlansResponse{Placement: placement, Campaigns: out})
}
