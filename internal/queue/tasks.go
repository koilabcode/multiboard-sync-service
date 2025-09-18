package queue

import "encoding/json"

const (
	TypeExport = "export:run"
	TypeImport = "import:run"
)

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

type ImportTaskPayload struct {
	Source   string `json:"source"`
	Target   string `json:"target"`
	DumpPath string `json:"dumpPath"`
	JobID    string `json:"jobId"`
	DumpSize int64  `json:"dumpSize"`
}

func NewImportTask(source, target, dumpPath, jobID string, dumpSize int64) (string, []byte, error) {
	payload, err := json.Marshal(ImportTaskPayload{
		Source:   source,
		Target:   target,
		DumpPath: dumpPath,
		JobID:    jobID,
		DumpSize: dumpSize,
	})
	if err != nil {
		return "", nil, err
	}
	return TypeImport, payload, nil
}
