// 景點資料同步機制新增的 /internal/maintenance/sync/* 端點(見
// docs/ATTRACTION_SYNC_DESIGN.md)。跟 maintenance.go 既有的
// /internal/maintenance/attractions* 端點分開檔案,但共用同一個
// package/命名空間/認證中介層(見 api.go 路由註冊處的說明)——這批端點
// 專門服務 attractionsync 套件(server/internal/attractionsync)的三層
// 比對 + 交握式傳輸,不是給前端或一般維運操作使用。
//
// 依設計文件「三、架構」:CLI 只負責觸發指令、顯示結果,不直接呼叫兩邊
// 的 API,也不執行任何比對邏輯——比對與資料搬運邏輯放在這裡(server
// 層),由本機 server 收到 CLI 觸發後,一律主動發起 HTTP 請求去跟同步
// 對象(target)的 server 對話。這個檔案同時扮演兩種角色:
//
//  1. 「本機」角色:handleMaintenanceSyncSetup/handleMaintenanceSyncRun
//     收到 CLI 的觸發,主動發起 HTTP 請求去跟 target 對話(push 情境下
//     自己執行比對決策;pull 情境下把探測/清單資料送給 target 的比對
//     端點,由 target 決策)。
//  2. 「目的方/來源方」角色:本檔案其餘的 handler(schema/server-time/
//     freshness/list/compare/write/update/delete)是「被動接收方」——
//     不管本機還是 target,只要是同一支 cmd/server 二進位檔,都同時
//     具備這些端點,同步時哪一邊扮演哪個角色純粹依請求方向決定(見
//     設計文件「三、架構」的角色對照表)。
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/attractionsync"
	"github.com/tim72117/tripace/internal/model"
)

// attractionSchemaFields 是 attractionRow(見
// server/internal/store/entity.go:66-85)的欄位名稱與型別描述,供
// handleMaintenanceAttractionSchema 回傳。寫死在這裡而非用反射從
// attractionRow 動態產生——store 層的 attractionRow 是套件私有型別,
// 這裡拿不到;反射也會把 gorm tag 這類實作細節意外暴露出去。這份清單
// 需要跟著 attractionRow 的欄位手動同步,如果之後 attractionRow 改動
// 欄位,這裡也要跟著更新(兩處都有明確的交互參照註解可以互相提醒)。
var attractionSchemaFields = []attractionsync.SchemaField{
	{Name: "id", Type: "string"},
	{Name: "name", Type: "string"},
	{Name: "city_name", Type: "string"},
	{Name: "lat", Type: "float64"},
	{Name: "lng", Type: "float64"},
	{Name: "level", Type: "int"},
	{Name: "radius_meters", Type: "int"},
	{Name: "summary", Type: "*string"},
	{Name: "photo_url", Type: "*string"},
	{Name: "created_at", Type: "time.Time"},
	{Name: "updated_at", Type: "time.Time"},
}

// GET /internal/maintenance/sync/attractions/schema
//
// 供「零、前置檢查」查詢這台伺服器 attractions 表的欄位/型別結構,讓
// 發起同步的一方能跟自己的 schema 逐項比對(見 attractionsync.CompareSchema)。
func (s *Server) handleMaintenanceAttractionSchema(w http.ResponseWriter, r *http.Request) {
	fields := make([]map[string]string, len(attractionSchemaFields))
	for i, f := range attractionSchemaFields {
		fields[i] = map[string]string{"name": f.Name, "type": f.Type}
	}
	writeJSON(w, http.StatusOK, map[string]any{"fields": fields})
}

// GET /internal/maintenance/sync/server-time
//
// 供「零、前置檢查」的時鐘偏移檢查取得這台伺服器當下時間(見
// attractionsync.CheckClockSkew)。
func (s *Server) handleMaintenanceServerTime(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"serverTime": time.Now().UTC()})
}

// GET /internal/maintenance/sync/attractions/freshness
//
// 第零層新鮮度探測:回傳這台伺服器目前的景點資料筆數,以及最新一筆的
// UpdatedAt/ID(見 docs/ATTRACTION_SYNC_DESIGN.md「二、傳輸流程」)。
// 尚未有任何資料時 count=0,不假造 latestId/latestUpdatedAt。
func (s *Server) handleMaintenanceAttractionFreshness(w http.ResponseWriter, r *http.Request) {
	all, err := s.store.ListAllAttractions()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	probe := attractionFreshness(all)
	resp := map[string]any{"count": probe.Count}
	if probe.Count > 0 {
		resp["latestId"] = probe.LatestID
		resp["latestUpdatedAt"] = probe.LatestUpdatedAt
	}
	writeJSON(w, http.StatusOK, resp)
}

// attractionFreshness 從一份完整的 model.Attraction 清單算出
// attractionsync.FreshnessProbe——ListAllAttractions 已依 UpdatedAt
// 由舊到新排序(見該方法說明),所以最新一筆就是切片最後一個元素,不需要
// 額外掃描比較。
func attractionFreshness(all []model.Attraction) attractionsync.FreshnessProbe {
	if len(all) == 0 {
		return attractionsync.FreshnessProbe{}
	}
	latest := all[len(all)-1]
	return attractionsync.FreshnessProbe{
		Count:           len(all),
		LatestUpdatedAt: latest.UpdatedAt,
		LatestID:        latest.ID,
	}
}

// GET /internal/maintenance/sync/attractions/list
//
// 第一層清單比對用:回傳這台伺服器全部景點資料的輕量清單(只含
// ID+UpdatedAt)。push 情境下,本機(來源＋決策方)呼叫 target 這支端點
// 取得目的方現狀,自行執行 DiffLite(見 docs/ATTRACTION_SYNC_DESIGN.md
// 「二、傳輸流程」的第一層)。pull 情境不會用到這支端點——pull 是本機
// 把自己的清單「送給」target 的 compare 端點,不是本機主動來查。
func (s *Server) handleMaintenanceAttractionSyncList(w http.ResponseWriter, r *http.Request) {
	all, err := s.store.ListAllAttractions()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	out := make([]attractionsync.LiteRecord, len(all))
	for i, a := range all {
		out[i] = attractionsync.LiteRecord{ID: a.ID, UpdatedAt: a.UpdatedAt}
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /internal/maintenance/sync/attractions/{id}
//
// 供 push 情境第二層(完整欄位比對)逐筆查詢交集 ID 在 target 上的完整
// 內容(見 runSyncPush)。獨立於既有 GET /internal/maintenance/attractions
// (那支是依 city 查詢一批、給人工瀏覽用),這支是單筆、依 ID 精確查詢,
// 服務同步流程的查詢型態不同。
func (s *Server) handleMaintenanceAttractionSyncGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少地標 ID")
		return
	}
	a, err := s.store.GetAttraction(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "找不到這筆景點資料")
		return
	}
	writeJSON(w, http.StatusOK, a)
}

// syncCompareRequest 是 POST /internal/maintenance/sync/attractions/compare
// 的請求內容——pull 情境下,目的方(本機)把自己的清單送過來,由這台
// 伺服器(來源＋決策方)執行比對(見 docs/ATTRACTION_SYNC_DESIGN.md
// 「三、架構」的「來源方決策」)。
type syncCompareRequest struct {
	DestinationList []attractionsync.LiteRecord `json:"destinationList"`
	// DestinationFullForIntersection 是「兩邊都有」那些 ID 的目的方完整
	// 內容——只需要交集部分,不是目的方全部資料,由呼叫端(pull 情境下的
	// 本機)在送出前用自己的 DestinationList 跟收到的 toCreate 判斷交集
	// 後夾帶。省略這個欄位仍相容(視為沒有交集資料可比,toUpdate 恆為
	// 空)——舊版呼叫端不受影響,只是拿不到欄位級更新的判定。
	DestinationFullForIntersection []model.Attraction `json:"destinationFullForIntersection,omitempty"`
}

// POST /internal/maintenance/sync/attractions/compare
//
// pull 專用端點:接受目的方(呼叫端)送來的清單,這台伺服器(來源＋決策方)
// 用自己的完整資料跟這份清單比對,回傳目的方該新增/更新/刪除的完整
// 內容(對應 attractionsync.PlanActions 的三種動作)。allowDelete 由
// 呼叫端(目的方)在請求中指定——是否允許刪除只在目的方視角有意義
// (「-allow-delete 這個旗標」是使用者對「pull 進本機」這個動作下的
// 指示,來源方本身不需要知道使用者有沒有加這個旗標,只是單純把「若
// 允許刪除的話會刪哪些」一併算出來,由目的方決定要不要套用 toDelete)。
func (s *Server) handleMaintenanceAttractionSyncCompare(w http.ResponseWriter, r *http.Request) {
	var req syncCompareRequest
	if !decode(w, r, &req) {
		return
	}

	all, err := s.store.ListAllAttractions()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}

	sourceList := make([]attractionsync.LiteRecord, len(all))
	byID := make(map[string]model.Attraction, len(all))
	for i, a := range all {
		sourceList[i] = attractionsync.LiteRecord{ID: a.ID, UpdatedAt: a.UpdatedAt}
		byID[a.ID] = a
	}

	diff := attractionsync.DiffLite(sourceList, req.DestinationList)

	toCreate := make([]model.Attraction, 0, len(diff.OnlyInSource))
	for _, id := range diff.OnlyInSource {
		toCreate = append(toCreate, byID[id])
	}

	// 交集部分:只有目的方也送來完整欄位內容才能比對(destinationList 目前
	// 只有 ID+UpdatedAt,見 syncCompareRequest),但這支端點的呼叫端
	// (handleMaintenanceSyncRun 的 pull 分支)在送出 compare 請求前,
	// 只握有本機的完整清單,可以直接把交集部分的本機內容一併附帶送出,
	// 讓來源方就地比對——見 syncCompareRequest 的 DestinationFull 欄位。
	var toUpdate []model.Attraction
	destByID := make(map[string]model.Attraction, len(req.DestinationFullForIntersection))
	for _, a := range req.DestinationFullForIntersection {
		destByID[a.ID] = a
	}
	for _, id := range diff.Intersection {
		destAttr, ok := destByID[id]
		if !ok {
			continue
		}
		if fieldDiffs := attractionsync.CompareFields(byID[id], destAttr); len(fieldDiffs) > 0 {
			toUpdate = append(toUpdate, byID[id])
		}
	}

	toDelete := diff.OnlyInDest // 只在目的方——是否套用交給目的方依 -allow-delete 決定

	writeJSON(w, http.StatusOK, map[string]any{
		"toCreate": toCreate,
		"toUpdate": toUpdate,
		"toDelete": toDelete,
	})
}

// POST /internal/maintenance/sync/attractions/write
//
// 交握式傳輸的逐筆寫入端點——請求 body 是完整的 model.Attraction(含
// ID),直接沿用該 ID 建檔(見 store.CreateAttractionWithID 的說明:
// 一般的 attraction-add/handleMaintenanceAttractionAdd 會產生新 ID,
// 但同步情境下目的方必須採用來源方的 ID,下一輪同步比對才不會誤判成
// 兩筆互不相干的記錄)。若該 ID 已存在(例如交握中斷後重新整批送出,
// 這筆先前其實已經寫入成功),視為冪等成功,直接回報已寫入,不視為
// 錯誤——交握協定本來就允許重新查詢斷點後,把「其實已經到達目的方」
// 的部分再送一次(見 docs/ATTRACTION_SYNC_DESIGN.md「二、傳輸流程」)。
func (s *Server) handleMaintenanceAttractionSyncWrite(w http.ResponseWriter, r *http.Request) {
	var in model.Attraction
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.ID) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 id")
		return
	}

	if _, err := s.store.GetAttraction(in.ID); err == nil {
		// 已存在:視為這筆先前已經同步過(冪等),直接回報成功,不重複
		// 建檔、也不覆蓋內容(內容層級的覆蓋屬於「兩邊都有、內容不同」
		// 的 update 情境,走 handleMaintenanceAttractionSyncUpdate,不是
		// write 端點的職責)。
		writeJSON(w, http.StatusOK, map[string]any{"id": in.ID, "written": true})
		return
	}

	if _, err := s.store.CreateAttractionWithID(in); err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": in.ID, "written": true})
}

// POST /internal/maintenance/sync/attractions/update
//
// 交握式傳輸中「兩邊都有、內容不同」情境的逐筆更新端點——用來源方版本
// 覆蓋目的方既有記錄(見 docs/ATTRACTION_SYNC_DESIGN.md「一、比對
// 模型」:單向同步下來源方就是權威版本,不需要判斷誰新誰舊)。
func (s *Server) handleMaintenanceAttractionSyncUpdate(w http.ResponseWriter, r *http.Request) {
	var in model.Attraction
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.ID) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 id")
		return
	}
	if err := s.store.UpdateAttractionFields(in); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": in.ID, "written": true})
}

// POST /internal/maintenance/sync/attractions/delete
//
// 交握式傳輸中「只在目的方」且呼叫端已明確加上 -allow-delete 情境的
// 逐筆刪除端點——獨立於既有的 DELETE /internal/maintenance/attractions/
// {id},因為那支是一般人工維運操作(單筆、當下觸發),這裡是同步流程
// 內部的一步,刻意用 POST + body 帶 id 的形狀對齊同一組 sync/* 端點的
// 呼叫慣例(write/update 皆是 POST body),不是特意要跟既有端點區分
// 語意——實際上直接呼叫既有的 store.DeleteAttraction。
func (s *Server) handleMaintenanceAttractionSyncDelete(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.ID) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 id")
		return
	}
	if err := s.store.DeleteAttraction(in.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": in.ID, "deleted": true})
}

// ============================================================
// 以下是「本機」角色專用的邏輯:CLI 觸發後,由本機 server 主動發起
// HTTP 請求去跟同步對象(target)對話(見檔案開頭的角色說明)。
// ============================================================

// setupSyncRequest 是 POST /internal/maintenance/sync/setup 的請求內容
// ——CLI(cmd/cli/attraction_sync.go)已經走完瀏覽器核准流程、換到 JWT,
// 這裡只負責把 {target, token} 存進本機 server 自己的 sync-token 檔案
// (見 synctoken.go)。這支端點本身也掛在 internalAuth 底下(見
// api.go 路由註冊處),呼叫端需要帶自己的個人登入 JWT——這與換到的
// sync-token 是兩把不同的 JWT,不要混淆:這支端點的 Authorization
// header 驗的是「呼叫這支設定端點的人是誰」,body 裡的 token 才是
// 「之後同步要用哪把 JWT 跟 target 對話」。
type setupSyncRequest struct {
	Target string `json:"target"`
	Token  string `json:"token"`
}

// POST /internal/maintenance/sync/setup
//
// 對應設計文件「四、認證」的 Phase 1 收尾:CLI 已經開瀏覽器導向 target
// 的核准頁、使用者核准後透過 callback 換到 JWT,CLI 呼叫這支端點把
// {target, token} 交給本機 server 存檔。
func (s *Server) handleMaintenanceSyncSetup(w http.ResponseWriter, r *http.Request) {
	var req setupSyncRequest
	if !decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Target) == "" || strings.TrimSpace(req.Token) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "target、token 皆為必填")
		return
	}
	if err := saveSyncToken(req.Target, req.Token); err != nil {
		writeErr(w, http.StatusInternalServerError, "save_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"target": req.Target, "ok": true})
}

// runSyncRequest 是 POST /internal/maintenance/sync/attractions/run 的
// 請求內容,對應 CLI `attraction-sync` 子命令的四個旗標。
type runSyncRequest struct {
	Direction   string `json:"direction"`
	AllowDelete bool   `json:"allowDelete"`
	Apply       bool   `json:"apply"`
	Retry       bool   `json:"retry"`
}

// clockSkewThreshold 見 docs/ATTRACTION_SYNC_DESIGN.md「零、前置檢查」:
// 門檻值量級以分鐘計,取 5 分鐘。
const clockSkewThreshold = 5 * time.Minute

// POST /internal/maintenance/sync/attractions/run
//
// 對應 CLI `attraction-sync -direction push|pull [-allow-delete] [-apply]
// [-retry]` 子命令觸發後,本機 server 實際執行的完整流程:零、前置檢查
// →（push:自行三層比對；pull:送給 target 的 compare 端點由對方決策)
// → dry-run 報告,或加上 apply 才真正交握式寫入(見 docs/
// ATTRACTION_SYNC_DESIGN.md「二、傳輸流程」)。
func (s *Server) handleMaintenanceSyncRun(w http.ResponseWriter, r *http.Request) {
	var req runSyncRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Direction != "push" && req.Direction != "pull" {
		writeErr(w, http.StatusBadRequest, "invalid_input", `direction 僅接受 "push" 或 "pull"`)
		return
	}

	syncTok, err := loadSyncToken()
	if err != nil {
		writeErr(w, http.StatusPreconditionFailed, "not_configured", err.Error())
		return
	}
	client := &syncClient{target: syncTok.Target, token: syncTok.Token}

	// 零、前置檢查:每次觸發同步都重新查一次,不快取上次結果(見設計
	// 文件「零、前置檢查」的說明)。
	schemaResult, err := s.checkSyncSchema(client)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "schema_check_failed", err.Error())
		return
	}
	if !schemaResult.Match {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":            map[string]string{"code": "schema_mismatch", "message": "兩邊 attractions 表結構不一致,已中止"},
			"schemaMismatches": schemaResult.Mismatches,
		})
		return
	}
	skewResult, err := s.checkClockSkew(client)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "clock_check_failed", err.Error())
		return
	}
	if !skewResult.OK {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":     map[string]string{"code": "clock_skew", "message": "兩邊系統時間偏移超過門檻,已中止"},
			"skewSecs":  skewResult.Skew.Seconds(),
			"threshold": clockSkewThreshold.Seconds(),
		})
		return
	}

	var report syncRunReport
	var runErr error
	if req.Direction == "push" {
		report, runErr = s.runSyncPush(client, req.AllowDelete, req.Apply)
	} else {
		report, runErr = s.runSyncPull(client, req.AllowDelete, req.Apply)
	}
	if runErr != nil {
		writeErr(w, http.StatusBadGateway, "sync_failed", runErr.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"target":      syncTok.Target,
		"direction":   req.Direction,
		"allowDelete": req.AllowDelete,
		"apply":       req.Apply,
		"retry":       req.Retry,
		"report":      report,
	})
}

// syncRunReport 是 dry-run 報告與 -apply 執行結果共用的輸出形狀。
type syncRunReport struct {
	NeedsSync    bool     `json:"needsSync"`
	SourceCount  int      `json:"sourceCount"`
	DestCount    int      `json:"destCount"`
	ToCreate     []string `json:"toCreate"`
	ToUpdate     []string `json:"toUpdate"`
	ToDelete     []string `json:"toDelete"`
	Applied      bool     `json:"applied"`
	WrittenCount int      `json:"writtenCount,omitempty"`
	Complete     *bool    `json:"complete,omitempty"`
}

// checkSyncSchema 比對本機與 target 的 attractions 表結構(見設計文件
// 「零、前置檢查」)。
func (s *Server) checkSyncSchema(client *syncClient) (attractionsync.SchemaCompareResult, error) {
	localFields := make([]attractionsync.SchemaField, len(attractionSchemaFields))
	copy(localFields, attractionSchemaFields)

	var remote struct {
		Fields []attractionsync.SchemaField `json:"fields"`
	}
	if err := client.get("/internal/maintenance/sync/attractions/schema", &remote); err != nil {
		return attractionsync.SchemaCompareResult{}, err
	}
	return attractionsync.CompareSchema(localFields, remote.Fields), nil
}

// checkClockSkew 比對本機與 target 當下系統時間的絕對差距(見設計文件
// 「零、前置檢查」的時鐘偏移檢查)。
func (s *Server) checkClockSkew(client *syncClient) (attractionsync.ClockSkewResult, error) {
	tLocal := time.Now().UTC()
	var remote struct {
		ServerTime time.Time `json:"serverTime"`
	}
	if err := client.get("/internal/maintenance/sync/server-time", &remote); err != nil {
		return attractionsync.ClockSkewResult{}, err
	}
	return attractionsync.CheckClockSkew(tLocal, remote.ServerTime, clockSkewThreshold), nil
}

// runSyncPush 執行 push 情境(本機是來源＋決策方,見設計文件「二、傳輸
// 流程」):依序查詢 target 的新鮮度探測/清單,自行比對算出差異,
// -apply 時才透過交握式傳輸逐筆寫入 target。
func (s *Server) runSyncPush(client *syncClient, allowDelete, apply bool) (syncRunReport, error) {
	localAll, err := s.store.ListAllAttractions()
	if err != nil {
		return syncRunReport{}, err
	}
	localProbe := attractionFreshness(localAll)

	var destProbe attractionsync.FreshnessProbe
	if err := client.get("/internal/maintenance/sync/attractions/freshness", &destProbeResponse{&destProbe}); err != nil {
		return syncRunReport{}, err
	}

	report := syncRunReport{SourceCount: localProbe.Count, DestCount: destProbe.Count}
	report.NeedsSync = attractionsync.NeedsSync(localProbe, destProbe)
	if !report.NeedsSync {
		return report, nil
	}

	var destList []attractionsync.LiteRecord
	if err := client.get("/internal/maintenance/sync/attractions/list", &destList); err != nil {
		return syncRunReport{}, err
	}

	localLite := make([]attractionsync.LiteRecord, len(localAll))
	localByID := make(map[string]model.Attraction, len(localAll))
	for i, a := range localAll {
		localLite[i] = attractionsync.LiteRecord{ID: a.ID, UpdatedAt: a.UpdatedAt}
		localByID[a.ID] = a
	}
	diff := attractionsync.DiffLite(localLite, destList)

	// 第二層:只對交集部分抓完整欄位比對——push 情境下,目的方(target)
	// 沒有一支「回傳完整內容」的清單端點(list 端點只回輕量清單),
	// 逐筆查詢交集 ID 的完整內容成本可控(attraction 資料量小,見設計
	// 文件「為什麼不需要衝突解決機制」的資料量假設),故用
	// GetAttraction 逐筆取得後比對。
	var toUpdate []string
	var toUpdateRecords []model.Attraction
	for _, id := range diff.Intersection {
		var destAttr model.Attraction
		if err := client.get("/internal/maintenance/sync/attractions/"+url.PathEscape(id), &destAttr); err != nil {
			continue // 單筆查詢失敗不中止整個 dry-run,略過這筆的欄位級比對
		}
		if fieldDiffs := attractionsync.CompareFields(localByID[id], destAttr); len(fieldDiffs) > 0 {
			toUpdate = append(toUpdate, id)
			toUpdateRecords = append(toUpdateRecords, localByID[id])
		}
	}

	report.ToCreate = diff.OnlyInSource
	report.ToUpdate = toUpdate
	if allowDelete {
		report.ToDelete = diff.OnlyInDest
	}

	if !apply {
		return report, nil
	}

	var toCreateRecords []model.Attraction
	for _, id := range diff.OnlyInSource {
		toCreateRecords = append(toCreateRecords, localByID[id])
	}

	written, complete, err := client.handshakeWrite(toCreateRecords, toUpdateRecords)
	if err != nil {
		return report, err
	}
	if allowDelete {
		for _, id := range diff.OnlyInDest {
			_ = client.post("/internal/maintenance/sync/attractions/delete", map[string]string{"id": id}, nil)
		}
	}
	report.Applied = true
	report.WrittenCount = written
	report.Complete = &complete
	return report, nil
}

// runSyncPull 執行 pull 情境(target 是來源＋決策方,見設計文件「二、
// 傳輸流程」):本機把自己的探測/清單資料送給 target 的比對端點,由
// target 決策後回傳結果,本機收到後直接寫入本機 DB,不在本機端執行
// 任何比對判斷。
func (s *Server) runSyncPull(client *syncClient, allowDelete, apply bool) (syncRunReport, error) {
	localAll, err := s.store.ListAllAttractions()
	if err != nil {
		return syncRunReport{}, err
	}
	localProbe := attractionFreshness(localAll)

	var sourceProbe attractionsync.FreshnessProbe
	if err := client.get("/internal/maintenance/sync/attractions/freshness", &destProbeResponse{&sourceProbe}); err != nil {
		return syncRunReport{}, err
	}

	report := syncRunReport{SourceCount: sourceProbe.Count, DestCount: localProbe.Count}
	report.NeedsSync = attractionsync.NeedsSync(sourceProbe, localProbe)
	if !report.NeedsSync {
		return report, nil
	}

	localLite := make([]attractionsync.LiteRecord, len(localAll))
	for i, a := range localAll {
		localLite[i] = attractionsync.LiteRecord{ID: a.ID, UpdatedAt: a.UpdatedAt}
	}

	var compareResp struct {
		ToCreate []model.Attraction `json:"toCreate"`
		ToUpdate []model.Attraction `json:"toUpdate"`
		ToDelete []string           `json:"toDelete"`
	}
	compareReq := syncCompareRequest{DestinationList: localLite, DestinationFullForIntersection: localAll}
	if err := client.post("/internal/maintenance/sync/attractions/compare", compareReq, &compareResp); err != nil {
		return syncRunReport{}, err
	}

	report.ToCreate = idsOf(compareResp.ToCreate)
	report.ToUpdate = idsOf(compareResp.ToUpdate)
	if allowDelete {
		report.ToDelete = compareResp.ToDelete
	}

	if !apply {
		return report, nil
	}

	written := 0
	for _, a := range sortByUpdatedAt(append(append([]model.Attraction{}, compareResp.ToCreate...), compareResp.ToUpdate...)) {
		if _, err := s.store.GetAttraction(a.ID); err == nil {
			if err := s.store.UpdateAttractionFields(a); err != nil {
				return report, fmt.Errorf("寫入 %s 失敗: %w", a.ID, err)
			}
		} else {
			if _, err := s.store.CreateAttractionWithID(a); err != nil {
				return report, fmt.Errorf("寫入 %s 失敗: %w", a.ID, err)
			}
		}
		written++
	}
	if allowDelete {
		for _, id := range compareResp.ToDelete {
			if err := s.store.DeleteAttraction(id); err != nil {
				return report, fmt.Errorf("刪除 %s 失敗: %w", id, err)
			}
		}
	}

	complete := written == len(compareResp.ToCreate)+len(compareResp.ToUpdate)
	report.Applied = true
	report.WrittenCount = written
	report.Complete = &complete
	return report, nil
}

func idsOf(records []model.Attraction) []string {
	out := make([]string, len(records))
	for i, r := range records {
		out[i] = r.ID
	}
	return out
}

func sortByUpdatedAt(records []model.Attraction) []model.Attraction {
	out := make([]model.Attraction, len(records))
	copy(out, records)
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.Before(out[j].UpdatedAt) })
	return out
}

// destProbeResponse 是 attractionsync.FreshnessProbe 對應的 JSON 回應
// 形狀轉接器——handleMaintenanceAttractionFreshness 回傳的欄位是
// count/latestId/latestUpdatedAt(小駝峰、且 count=0 時省略後兩者),
// 跟 FreshnessProbe 本身的 Go 欄位名稱不同,需要一層轉接,不能直接
// json.Unmarshal 進 FreshnessProbe。
type destProbeResponse struct {
	target *attractionsync.FreshnessProbe
}

func (d *destProbeResponse) UnmarshalJSON(data []byte) error {
	var raw struct {
		Count           int        `json:"count"`
		LatestID        string     `json:"latestId"`
		LatestUpdatedAt *time.Time `json:"latestUpdatedAt"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	d.target.Count = raw.Count
	d.target.LatestID = raw.LatestID
	if raw.LatestUpdatedAt != nil {
		d.target.LatestUpdatedAt = *raw.LatestUpdatedAt
	}
	return nil
}

// syncClient 是本機 server 對 target 發起同步相關請求的最小 HTTP
// helper——所有請求都帶 Authorization: Bearer <sync-token>(見設計文件
// 「四、認證」)。刻意不重用 geo.Client 之類既有的 HTTP client 封裝,
// 這裡的需求(固定 target base URL + 固定 bearer token,打自家
// /internal/maintenance/* 端點)夠簡單,獨立一個小型 client 更直接。
type syncClient struct {
	target string
	token  string
}

func (c *syncClient) get(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, strings.TrimSuffix(c.target, "/")+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	return c.do(req, out)
}

func (c *syncClient) post(path string, body, out any) error {
	var r *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimSuffix(c.target, "/")+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.do(req, out)
}

func (c *syncClient) do(req *http.Request, out any) error {
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("連不上 %s: %w", c.target, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var errBody map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		return fmt.Errorf("target 回應 %d: %v", resp.StatusCode, errBody)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// handshakeWrite 對 target 執行交握式傳輸(見設計文件「二、傳輸流程」
// 的交握協定):依 UpdatedAt 由舊到新排序後逐筆呼叫 write/update 端點,
// 每筆立刻確認回應是否成功;任何一筆失敗就停止,回傳目前已完成的筆數
// 與是否全部完成——筆數不符時,呼叫端(runSyncPush)不在這裡自動重試,
// 交由使用者下次呼叫 attraction-sync(或帶 -retry)時,重新查詢 target
// 當下最新狀態、重新跑一次三層比對接續(見設計文件對「不猜斷點」的
// 說明)。
func (c *syncClient) handshakeWrite(toCreate, toUpdate []model.Attraction) (written int, complete bool, err error) {
	type item struct {
		attr  model.Attraction
		isNew bool
	}
	items := make([]item, 0, len(toCreate)+len(toUpdate))
	for _, a := range toCreate {
		items = append(items, item{attr: a, isNew: true})
	}
	for _, a := range toUpdate {
		items = append(items, item{attr: a, isNew: false})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].attr.UpdatedAt.Before(items[j].attr.UpdatedAt) })

	for _, it := range items {
		path := "/internal/maintenance/sync/attractions/write"
		if !it.isNew {
			path = "/internal/maintenance/sync/attractions/update"
		}
		var result struct {
			Written bool `json:"written"`
		}
		if postErr := c.post(path, it.attr, &result); postErr != nil || !result.Written {
			return written, false, postErr
		}
		written++
	}
	return written, written == len(items), nil
}
