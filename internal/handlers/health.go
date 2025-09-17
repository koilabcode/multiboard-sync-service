package handlers

import (
	"encoding/json"
	"net/http"
)

type healthResp struct {
	Status string `json:"status"`
}

func Health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(healthResp{Status: "ok"})
}
