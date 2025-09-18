package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrDBNotConfigured = errors.New("database not configured")

type Manager struct {
	urls  URLs
	pools map[string]*pgxpool.Pool
}

func NewManager(ctx context.Context, urls URLs) (*Manager, error) {
	m := &Manager{
		urls:  urls,
		pools: make(map[string]*pgxpool.Pool, 3),
	}

	for _, name := range urls.ListConfigured() {
		dsn, _ := urls.Get(name)
		cfg, err := pgxpool.ParseConfig(dsn)
		if err != nil {
			return nil, err
		}
		cfg.MaxConns = 25
		cfg.ConnConfig.ConnectTimeout = 30 * time.Second

		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			return nil, err
		}
		if err := pingWithRetry(ctx, pool); err != nil {
			pool.Close()
			continue
		}
		m.pools[name] = pool
	}

	return m, nil
}

func pingWithRetry(ctx context.Context, pool *pgxpool.Pool) error {
	var err error
	backoff := 500 * time.Millisecond
	for attempt := 1; attempt <= 3; attempt++ {
		ctxPing, cancel := context.WithTimeout(ctx, 30*time.Second)
		err = pool.Ping(ctxPing)
		cancel()
		if err == nil {
			return nil
		}
		if attempt < 3 {
			select {
			case <-time.After(backoff):
				backoff *= 2
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return err
}

func (m *Manager) ListDatabases() []string {
	return m.urls.ListConfigured()
}

func (m *Manager) getOrCreatePool(ctx context.Context, name string) (*pgxpool.Pool, error) {
	if p, ok := m.pools[name]; ok && p != nil {
		return p, nil
	}
	dsn, ok := m.urls.Get(name)
	if !ok {
		return nil, ErrDBNotConfigured
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 25
	cfg.ConnConfig.ConnectTimeout = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pingWithRetry(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	m.pools[name] = pool
	return pool, nil
}

func (m *Manager) TestConnection(ctx context.Context, name string) (bool, string, error) {
	pool, err := m.getOrCreatePool(ctx, name)
	if err != nil {
		return false, "", err
	}
	ctxQ, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var version string
	if err := pool.QueryRow(ctxQ, "select version()").Scan(&version); err != nil {
		return false, "", err
	}
	return true, version, nil
}

func (m *Manager) Close() {
	for _, p := range m.pools {
		if p != nil {
			p.Close()
		}
	}
}

func (m *Manager) Pool(ctx context.Context, name string) (*pgxpool.Pool, error) {
	return m.getOrCreatePool(ctx, name)
}
