package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/hibiken/asynq"
	"github.com/koilabcode/multiboard-sync-service/internal/database"
	"github.com/koilabcode/multiboard-sync-service/internal/export"
	"github.com/koilabcode/multiboard-sync-service/internal/models"
)

type Worker struct {
	server   *asynq.Server
	mux      *asynq.ServeMux
	jobs     *models.JobStore
	mgr      *database.Manager
	exporter *export.Exporter
}

func NewWorker(redisURL string, jobs *models.JobStore, mgr *database.Manager) (*Worker, error) {
	opt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, err
	}
	srv := asynq.NewServer(opt, asynq.Config{
		Concurrency: 5,
		Queues: map[string]int{
			"default": 1,
		},
	})
	mux := asynq.NewServeMux()
	w := &Worker{server: srv, mux: mux, jobs: jobs, mgr: mgr}
	w.exporter = export.New(mgr)
	mux.HandleFunc(TypeExport, w.handleExport)
	return w, nil
}

func (w *Worker) performExport(ctx context.Context, db string, jobID string) error {
	if err := os.MkdirAll("dumps", 0o755); err != nil {
		return err
	}
	filename := fmt.Sprintf("dumps/%s_%s.sql", db, time.Now().Format("20060102_150405"))
	f, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer f.Close()

	progFn := func(current, total int, table string, rows int64) {
		pct := int((float64(current) / float64(total)) * 100.0)
		if pct > 100 {
			pct = 100
		}
		w.jobs.Update(jobID, func(j *models.Job) {
			j.Progress = pct
			j.CurrentTable = table
			j.RowsExported = rows
		})
	}

	_, _ = f.WriteString(fmt.Sprintf("-- Export started at %s\n\n", time.Now().UTC().Format(time.RFC3339)))
	if err := w.exporter.Export(ctx, db, f, progFn); err != nil {
		return err
	}
	w.jobs.Update(jobID, func(j *models.Job) {
		j.Progress = 100
	})
	return nil
}

func (w *Worker) handleExport(ctx context.Context, t *asynq.Task) error {
	var p ExportTaskPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return err
	}
	now := time.Now()
	w.jobs.Update(p.JobID, func(j *models.Job) {
		j.Status = models.StatusRunning
		j.StartedAt = &now
		j.Progress = 0
	})
	log.Printf("Starting export for database %s (job %s)", p.Database, p.JobID)

	if err := w.performExport(ctx, p.Database, p.JobID); err != nil {
		w.jobs.Update(p.JobID, func(j *models.Job) {
			j.Status = models.StatusFailed
			j.Error = err.Error()
		})
		log.Printf("Export failed for job %s: %v", p.JobID, err)
		return err
	}

	done := time.Now()
	w.jobs.Update(p.JobID, func(j *models.Job) {
		j.Status = models.StatusCompleted
		j.CompletedAt = &done
		j.Progress = 100
	})
	log.Printf("Completed export for job %s", p.JobID)
	return nil
}

func (w *Worker) Start() {
	go func() {
		if err := w.server.Start(w.mux); err != nil {
			log.Printf("asynq server stopped: %v", err)
		}
	}()
}

func (w *Worker) Shutdown() {
	w.server.Shutdown()
}
