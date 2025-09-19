package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/koilabcode/multiboard-sync-service/internal/config"
	"github.com/koilabcode/multiboard-sync-service/internal/database"
	"github.com/koilabcode/multiboard-sync-service/internal/handlers"
	"github.com/koilabcode/multiboard-sync-service/internal/models"
	"github.com/koilabcode/multiboard-sync-service/internal/queue"
)

func main() {
	_ = godotenv.Load()

	zerolog.TimeFieldFormat = time.RFC3339
	cfg := config.Load()

	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)

	log.Info().Msgf("Server starting on port %s", cfg.Port)

	urls := database.LoadURLs()
	mgr, err := database.NewManager(context.Background(), urls)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to initialize database manager")
	}

	jobs := models.NewJobStore()
	client, err := queue.NewClient(cfg.RedisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("asynq client error")
	}
	worker, err := queue.NewWorker(cfg.RedisURL, jobs, mgr)
	if err != nil {
		log.Fatal().Err(err).Msg("asynq worker error")
	}
	_ = worker.Start

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handlers.Health)

	dbh := handlers.DatabasesHandler{Manager: mgr}
	mux.HandleFunc("/api/databases", dbh.List)
	mux.HandleFunc("/api/databases/test", dbh.Test)

	eh := &handlers.ExportHandler{Jobs: jobs, Client: client}
	mux.HandleFunc("/api/sync/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		eh.StartExport(w, r)
	})

	ih := &handlers.ImportHandler{Jobs: jobs, Client: client}
	mux.HandleFunc("/api/sync/import", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ih.StartImport(w, r)
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

	fs := http.FileServer(http.Dir("cmd/server/static"))
	mux.Handle("/", fs)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: loggingMiddleware(mux),
	}

	worker.Start()

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	<-stop
	log.Info().Msg("shutdown signal received")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	mgr.Close()
	worker.Shutdown()
	if err := client.Close(); err != nil {
		log.Error().Err(err).Msg("Redis close error")
	}

	if err := srv.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("graceful shutdown failed")
	} else {
		log.Info().Msg("server stopped gracefully")
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Info().
			Str("method", r.Method).
			Str("path", r.URL.Path).
			Dur("dur_ms", time.Since(start)).
			Msg("request")
	})
}
