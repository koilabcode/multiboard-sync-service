package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/hibiken/asynq"
	"github.com/koilabcode/multiboard-sync-service/internal/config"
	"github.com/koilabcode/multiboard-sync-service/internal/handlers"
	"github.com/koilabcode/multiboard-sync-service/internal/models"
	"github.com/koilabcode/multiboard-sync-service/internal/queue"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	jobs := models.NewJobStore()
	client, err := queue.NewClient(cfg.RedisURL)
	if err != nil {
		log.Fatalf("asynq client error: %v", err)
	}
	defer client.Close()

	worker, err := queue.NewWorker(cfg.RedisURL, jobs)
	if err != nil {
		log.Fatalf("asynq worker error: %v", err)
	}
	worker.Start()
	defer worker.Shutdown()

	eh := &handlers.ExportHandler{Jobs: jobs, Client: client}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/sync/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		eh.StartExport(w, r)
	})
	mux.HandleFunc("/api/jobs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		eh.ListJobs(w, r)
	})
	mux.HandleFunc("/api/jobs/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		eh.GetJob(w, r)
	})
	mux.Handle("/", http.FileServer(http.Dir("cmd/server/static")))

	addr := ":" + strconv.Itoa(cfg.Port)
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	go func() {
		log.Printf("Server listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, os.Interrupt, syscall.SIGTERM)
	<-sigc
	log.Println("Shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}
	worker.Shutdown()
	_ = client.Close()
	_ = asynq.ErrServerClosed
}
