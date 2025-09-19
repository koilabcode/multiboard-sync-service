package queue

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
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
	mux.HandleFunc(TypeImport, w.handleImport)
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
		return fmt.Errorf("exporter.Export db=%s: %w", db, err)
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

func (w *Worker) performImport(ctx context.Context, target, jobID, dumpPath string, dumpSize int64) error {
	pool, err := w.mgr.Pool(ctx, target)
	if err != nil {
		return err
	}
	f, err := os.Open(dumpPath)
	if err != nil {
		return err
	}
	defer f.Close()

	reader := bufio.NewReaderSize(f, 1024*256)
	var (
		stmtBuf     strings.Builder
		totalRead   int64
		lastUpdated time.Time
	)

	updateProgress := func() {
		if dumpSize <= 0 {
			return
		}
		pct := int((float64(totalRead) / float64(dumpSize)) * 100.0)
		if pct > 100 {
			pct = 100
		}
		w.jobs.Update(jobID, func(j *models.Job) {
			j.Progress = pct
		})
	}

	for {
		chunk, err := reader.ReadString('\n')
		if len(chunk) > 0 {
			totalRead += int64(len(chunk))
			lineTrim := strings.TrimSpace(chunk)
			if strings.HasPrefix(lineTrim, "--") {
				if time.Since(lastUpdated) > 500*time.Millisecond {
					updateProgress()
					lastUpdated = time.Now()
				}
				continue
			}
			stmtBuf.WriteString(chunk)
			if strings.HasSuffix(strings.TrimSpace(chunk), ";") {
				stmt := strings.TrimSpace(stmtBuf.String())
				stmtBuf.Reset()
				if stmt != "" {
					if _, errExec := pool.Exec(ctx, stmt); errExec != nil {
						max := 500
						if len(stmt) < max {
							max = len(stmt)
						}
						return fmt.Errorf("exec failed: %w; stmt: %s", errExec, strings.TrimSpace(stmt[:max]))
					}
				}
			}
			if time.Since(lastUpdated) > 500*time.Millisecond {
				updateProgress()
				lastUpdated = time.Now()
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
	}
	if s := strings.TrimSpace(stmtBuf.String()); s != "" {
		if _, err := pool.Exec(ctx, s); err != nil {
			return fmt.Errorf("exec failed: %w", err)
		}
	}
	w.jobs.Update(jobID, func(j *models.Job) {
		j.Progress = 100
	})
	return nil
}

func (w *Worker) handleImport(ctx context.Context, t *asynq.Task) error {
	var p ImportTaskPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return err
	}
	now := time.Now()
	w.jobs.Update(p.JobID, func(j *models.Job) {
		j.Status = models.StatusRunning
		j.StartedAt = &now
		j.Progress = 0
	})
	log.Printf("Starting import from %s (%s) into %s (job %s)", p.Source, p.DumpPath, p.Target, p.JobID)

	if err := w.performImport(ctx, p.Target, p.JobID, p.DumpPath, p.DumpSize); err != nil {
		w.jobs.Update(p.JobID, func(j *models.Job) {
			j.Status = models.StatusFailed
			j.Error = err.Error()
		})
		log.Printf("Import failed for job %s: %v", p.JobID, err)
		return err
	}

	done := time.Now()
	w.jobs.Update(p.JobID, func(j *models.Job) {
		j.Status = models.StatusCompleted
		j.CompletedAt = &done
		j.Progress = 100
	})
	log.Printf("Completed import for job %s", p.JobID)
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
