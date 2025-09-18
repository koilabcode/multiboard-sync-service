package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/koilabcode/multiboard-sync-service/internal/models"
	"github.com/koilabcode/multiboard-sync-service/internal/queue"
)

type ImportHandler struct {
	Jobs   *models.JobStore
	Client *asynq.Client
}

type importReq struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

func (h *ImportHandler) StartImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req importReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	req.Source = strings.ToLower(strings.TrimSpace(req.Source))
	req.Target = strings.ToLower(strings.TrimSpace(req.Target))

	validSrc := map[string]bool{"dev": true, "staging": true, "production": true, "localhost": true}
	if !validSrc[req.Source] {
		http.Error(w, "Invalid source", http.StatusBadRequest)
		return
	}
	if req.Target != "localhost" {
		http.Error(w, "Invalid target; only 'localhost' is allowed", http.StatusBadRequest)
		return
	}

	pattern := filepath.Join("dumps", req.Source+"_*.sql")
	matches, _ := filepath.Glob(pattern)
	if len(matches) == 0 {
		http.Error(w, "No export found, please export first", http.StatusBadRequest)
		return
	}
	sort.Slice(matches, func(i, j int) bool {
		fi, _ := os.Stat(matches[i])
		fj, _ := os.Stat(matches[j])
		var ti, tj time.Time
		if fi != nil {
			ti = fi.ModTime()
		}
		if fj != nil {
			tj = fj.ModTime()
		}
		return ti.After(tj)
	})
	dumpPath := matches[0]
	st, err := os.Stat(dumpPath)
	if err != nil || st.IsDir() {
		http.Error(w, "No export found, please export first", http.StatusBadRequest)
		return
	}

	id := uuid.New().String()
	h.Jobs.Create(&models.Job{
		ID:       id,
		Database: req.Target,
		Status:   models.StatusPending,
		Progress: 0,
	})

	typ, payload, err := queue.NewImportTask(req.Source, req.Target, dumpPath, id, st.Size())
	if err != nil {
		http.Error(w, "failed to create task", http.StatusInternalServerError)
		return
	}
	task := asynq.NewTask(typ, payload)
	if _, err := h.Client.Enqueue(task, asynq.Queue("default")); err != nil {
		http.Error(w, "enqueue failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"jobId":  id,
		"status": "queued",
	})
}
