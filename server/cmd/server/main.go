// Command server 啟動 Channel 後端 HTTP 服務(SQLite 原型)。
package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/channel/server/internal/api"
	"github.com/channel/server/internal/auth"
	"github.com/channel/server/internal/llm"
	"github.com/channel/server/internal/model"
	"github.com/channel/server/internal/store"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP 監聽位址")
	dbPath := flag.String("db", "channel.db", "SQLite 資料庫檔案路徑")
	seed := flag.Bool("seed", true, "資料庫為空時寫入示範資料")
	jwtSecret := flag.String("jwt-secret", "dev-secret-change-me", "JWT 簽章金鑰")
	devMode := flag.Bool("dev", true, "開發模式:Apple token 不驗簽章")
	llmKind := flag.String("llm", "rule", "LLM 分析器:rule(規則式)| want(接 want 引擎)")
	flag.Parse()

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	if *seed {
		if err := seedUsers(st); err != nil {
			log.Printf("seed users: %v", err)
		}
		if err := seedIfEmpty(st); err != nil {
			log.Printf("seed: %v", err)
		}
	}

	var analyzer llm.Analyzer = llm.NewRuleBased()
	if *llmKind == "want" {
		wantAnalyzer, err := llm.NewWant()
		if err != nil {
			log.Fatalf("初始化 want 分析器失敗: %v", err)
		}
		analyzer = wantAnalyzer
		log.Printf("LLM 分析器: want 引擎")
	} else {
		log.Printf("LLM 分析器: 規則式")
	}

	signer := auth.NewSigner(*jwtSecret, 30*24*time.Hour)
	srv := api.New(st, analyzer, signer, *devMode)

	log.Printf("Channel server 監聽 %s,DB=%s", *addr, *dbPath)
	if err := http.ListenAndServe(*addr, srv.Routes()); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// seedUsers 確保可邀請的使用者目錄存在(冪等,每次啟動都套用)。
func seedUsers(st *store.Store) error {
	directory := []model.User{
		{ID: "usr_alice", Name: "Alice", AvatarColor: "#E07A5F"},
		{ID: "usr_bob", Name: "Bob", AvatarColor: "#3D9970"},
		{ID: "usr_carol", Name: "Carol", AvatarColor: "#B07AE0"},
		{ID: "usr_dave", Name: "Dave", AvatarColor: "#E0B24A"},
	}
	for _, u := range directory {
		if err := st.UpsertUser(u); err != nil {
			return err
		}
	}
	return nil
}

// seedIfEmpty 在沒有任何頻道時建立一個示範頻道(對齊 App 端 Mock)。
func seedIfEmpty(st *store.Store) error {
	chs, err := st.ListChannels()
	if err != nil {
		return err
	}
	if len(chs) > 0 {
		return nil
	}
	me := model.User{ID: "usr_me", Name: "我", AvatarColor: "#4A90D9"}
	ch, err := st.CreateChannel("ch_001", "產品討論", me)
	if err != nil {
		return err
	}
	an := llm.NewRuleBased()
	for _, text := range []string{
		"我們下週一下午三點開會,敲定 Q3 產品規格",
		"記得把預算上調的提案準備好,大概要 +15%",
		"登入頁的 bug 修好了嗎?",
	} {
		ann := an.Classify(text)
		_ = st.InsertMessage(model.Message{
			ID:         "msg_" + randHex(),
			ChannelID:  ch.ID,
			AuthorID:   me.ID,
			AuthorName: me.Name,
			Text:       text,
			Category:   ann.Category,
			Tags:       ann.Tags,
			Summary:    ann.Summary,
			CreatedAt:  nowUTC(),
		})
	}
	log.Printf("已寫入示範頻道 %s", ch.ID)
	return nil
}
