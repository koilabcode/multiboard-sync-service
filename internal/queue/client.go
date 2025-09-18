package queue

import (
	"github.com/hibiken/asynq"
)

func NewClient(redisURL string) (*asynq.Client, error) {
	opt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, err
	}
	return asynq.NewClient(opt), nil
}
