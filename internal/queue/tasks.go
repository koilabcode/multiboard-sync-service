package queue

import "encoding/json"

const TypeExport = "export:run"

type ExportTaskPayload struct {
	Database string `json:"database"`
	JobID    string `json:"jobId"`
}

func NewExportTask(db, jobID string) (string, []byte, error) {
	payload, err := json.Marshal(ExportTaskPayload{
		Database: db,
		JobID:    jobID,
	})
	if err != nil {
		return "", nil, err
	}
	return TypeExport, payload, nil
}
