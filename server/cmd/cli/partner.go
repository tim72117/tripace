package main

import "flag"

// cmdPartnerGrant 走 POST /internal/maintenance/partners(見 server/
// internal/api/maintenance.go handleMaintenancePartnerGrant 的完整
// 說明)——把一個既有的一般 Tripace 使用者帳號(依 email 查)標記為廣告
// 業主/聯盟行銷夥伴身分。這是純內部維運操作,目前沒有自助申請流程
// (2026-10 明確決定延後),只能透過這個指令由內部人員手動開通,開通後
// 該使用者就能用原本的 Tripace 帳號密碼登入業主控制台(web/partner,
// /partner/*)。
//
// 不是 resource-first 的二段式指令(不走 buildResources/resource 機制)
// ——跟 geocode/notify 一樣是不屬於任何特定資源的全域指令,比照
// cmdGeocode 的既有風格獨立成一個檔案。
func cmdPartnerGrant(args []string, defaultAPI string) {
	fs := flag.NewFlagSet("partner-grant", flag.ExitOnError)
	email := fs.String("email", "", "既有 Tripace 使用者的 email（必填）")
	name := fs.String("name", "", "業主對外顯示名稱（選填，例如公司/品牌名；沒給時用 email）")
	apiURLFlag := fs.String("api", defaultAPI, "server URL")
	_ = fs.Parse(args)

	if *email == "" {
		fatal("partner-grant 需要 -email")
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("POST", "/internal/maintenance/partners", map[string]string{
		"email": *email,
		"name":  *name,
	})
	if err != nil {
		fatal("partner-grant: %v", err)
	}
	output(res)
}
