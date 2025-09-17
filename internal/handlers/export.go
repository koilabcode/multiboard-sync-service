package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/koilabcode/multiboard-sync-service/internal/models"
	"github.com/koilabcode/multiboard-sync-service/internal/queue"
)

type ExportHandler struct {
	Jobs   *models.JobStore
	Client *asynq.Client
}

type exportReq struct {
	Database string `json:"database"`
}

func (h *ExportHandler) StartExport(w http.ResponseWriter, r *http.Request) {
	var req exportReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Database == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	id := uuid.New().String()
	h.Jobs.Create(&models.Job{
		ID:       id,
		Database: req.Database,
		Status:   models.StatusPending,
		Progress: 0,
	})
	typ, payload, err := queue.NewExportTask(req.Database, id)
	if err != nil {
		http.Error(w, "failed to create task", http.StatusInternalServerError)
		return
	}
	task := asynq.NewTask(typ, payload)
	if _, err := h.Client.Enqueue(task, asynq.Queue("default")); err != nil {
		log.Printf("enqueue error: %v", err)
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

func (h *ExportHandler) ListJobs(w http.ResponseWriter, r *http.Request) {
	jobs := h.Jobs.List()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(jobs)
}

func (h *ExportHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	i := len(path) - 1
	for i >= 0 && path[i] != '/' {
		i--
	}
	id := ""
	if i >= 0 && i < len(path)-1 {
		id = path[i+1:]
	}
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	if job, ok := h.Jobs.Get(id); ok {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(job)
		return
	}
	http.NotFound(w, r)
}
