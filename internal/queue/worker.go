package queue

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"github.com/koilabcode/multiboard-sync-service/internal/models"
)

type Worker struct {
	server *asynq.Server
	mux    *asynq.ServeMux
	jobs   *models.JobStore
}

func NewWorker(redisURL string, jobs *models.JobStore) (*Worker, error) {
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
	w := &Worker{server: srv, mux: mux, jobs: jobs}
	mux.HandleFunc(TypeExport, w.handleExport)
	return w, nil
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

	for i := 1; i <= 10; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(1 * time.Second):
			prog := i * 10
			w.jobs.Update(p.JobID, func(j *models.Job) {
				j.Progress = prog
			})
			log.Printf("Job %s progress %d%%", p.JobID, prog)
		}
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
