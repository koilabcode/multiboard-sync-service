package config

import (
	"fmt"
	"net/url"
	"os"
)

type Config struct {
	Port     string
	LogLevel string
	RedisURL string
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() Config {
	port := getenv("PORT", "8080")
	logLevel := getenv("LOG_LEVEL", "info")
	redisURL := getenv("REDIS_URL", "redis://127.0.0.1:6379")
	if _, err := url.Parse(redisURL); err != nil {
		redisURL = "redis://127.0.0.1:6379"
		_ = fmt.Errorf("invalid REDIS_URL; defaulting to %s", redisURL)
	}
	return Config{
		Port:     port,
		LogLevel: logLevel,
		RedisURL: redisURL,
	}
}
