package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
)

type Config struct {
	RedisURL string
	Port     int
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() (*Config, error) {
	redisURL := getenv("REDIS_URL", "redis://127.0.0.1:6379")
	if _, err := url.Parse(redisURL); err != nil {
		return nil, fmt.Errorf("invalid REDIS_URL: %w", err)
	}
	port := 8080
	if v := os.Getenv("PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			port = p
		}
	}
	return &Config{
		RedisURL: redisURL,
		Port:     port,
	}, nil
}
