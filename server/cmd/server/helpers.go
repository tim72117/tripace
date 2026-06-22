package main

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

func randHex() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func nowUTC() time.Time { return time.Now().UTC() }
