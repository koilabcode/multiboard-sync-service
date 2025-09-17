package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/koilabcode/multiboard-sync-service/internal/database"
)

type DatabasesHandler struct {
	Manager *database.Manager
}

type listResp struct {
	Databases []string `json:"databases"`
}

type testReq struct {
	Database string `json:"database"`
}

type testResp struct {
	Database  string `json:"database"`
	Connected bool   `json:"connected"`
	Version   string `json:"version,omitempty"`
	Error     string `json:"error,omitempty"`
}

func (h DatabasesHandler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(listResp{Databases: h.Manager.ListDatabases()})
}

func (h DatabasesHandler) Test(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req testReq
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil || req.Database == "" {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	connected, version, err := h.Manager.TestConnection(r.Context(), req.Database)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, database.ErrDBNotConfigured) {
			status = http.StatusBadRequest
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(testResp{
			Database:  req.Database,
			Connected: false,
			Error:     err.Error(),
		})
		return
	}
	_ = json.NewEncoder(w).Encode(testResp{
		Database:  req.Database,
		Connected: connected,
		Version:   version,
	})
}
