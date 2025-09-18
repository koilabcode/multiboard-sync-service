package export

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/koilabcode/multiboard-sync-service/internal/database"
)

type ProgressFn func(currentTableIdx, totalTables int, tableName string, rowsExported int64)

type Exporter struct {
	mgr *database.Manager
}

func New(mgr *database.Manager) *Exporter {
	return &Exporter{mgr: mgr}
}

var includeTables = map[string]bool{
	"Part":           true,
	"Component":      true,
	"Attribute":      true,
	"AttributeValue": true,
	"Categories":     true,
	"Pack":           true,
	"Tag":            true,
	"Image":          true,
	"Option":         true,
}

var excludeTables = map[string]bool{
	"Profile":            true,
	"ProfileMeta":        true,
	"List":               true,
	"ListPart":           true,
	"_prisma_migrations": true,
}

func (e *Exporter) Export(ctx context.Context, dbName string, w io.Writer, progress ProgressFn) error {
	pool, err := e.Pool(ctx, dbName)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(w, 1024*256)
	defer bw.Flush()

	fmt.Fprintf(bw, "-- Multiboard SQL export\n-- Database: %s\n-- Generated: %s\n\n", dbName, time.Now().UTC().Format(time.RFC3339))

	tables, err := listPublicTables(ctx, pool)
	if err != nil {
		return err
	}
	filtered := make([]string, 0, len(tables))
	for _, t := range tables {
		if excludeTables[t] {
			continue
		}
		if includeTables[t] {
			filtered = append(filtered, t)
		}
	}
	sort.Strings(filtered)

	total := len(filtered)
	for i, tbl := range filtered {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err := writeCreateTable(ctx, pool, bw, tbl); err != nil {
			return fmt.Errorf("create table for %s: %w", tbl, err)
		}
		rows, err := streamInserts(ctx, pool, bw, tbl, func(rowsExported int64) {
			if progress != nil {
				progress(i+1, total, tbl, rowsExported)
			}
		})
		if err != nil {
			return fmt.Errorf("data for %s: %w", tbl, err)
		}
		if progress != nil {
			progress(i+1, total, tbl, rows)
		}
		fmt.Fprintln(bw)
	}
	return bw.Flush()
}

func (e *Exporter) Pool(ctx context.Context, name string) (*pgxpool.Pool, error) {
	return e.mgr.Pool(ctx, name)
}

func listPublicTables(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	sql := `
select table_name
from information_schema.tables
where table_schema = 'public' and table_type='BASE TABLE'
order by table_name`
	rows, err := pool.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

type columnDef struct {
	Name       string
	Type       string
	IsNullable bool
	Default    sql.NullString
}

func writeCreateTable(ctx context.Context, pool *pgxpool.Pool, w *bufio.Writer, table string) error {
	cols, err := getColumns(ctx, pool, table)
	if err != nil {
		return err
	}
	fmt.Fprintf(w, "--\n-- Table: %s\n--\n", quoteIdent(table))
	fmt.Fprintf(w, "DROP TABLE IF EXISTS %s CASCADE;\n", quoteIdent(table))
	fmt.Fprintf(w, "CREATE TABLE %s (\n", quoteIdent(table))
	for i, c := range cols {
		nullStr := "NOT NULL"
		if c.IsNullable {
			nullStr = "NULL"
		}
		defStr := ""
		if c.Default.Valid && c.Default.String != "" {
			defStr = " DEFAULT " + c.Default.String
		}
		sep := ","
		if i == len(cols)-1 {
			sep = ""
		}
		fmt.Fprintf(w, "  %s %s %s%s%s\n", quoteIdent(c.Name), c.Type, nullStr, defStr, sep)
	}
	fmt.Fprintln(w, ");")
	return nil
}

func getColumns(ctx context.Context, pool *pgxpool.Pool, table string) ([]columnDef, error) {
	q := `
select c.column_name,
       case
         when c.data_type='USER-DEFINED' then c.udt_name
         when c.data_type='timestamp without time zone' then 'timestamp'
         when c.data_type='timestamp with time zone' then 'timestamptz'
         when c.data_type='double precision' then 'double precision'
         when c.data_type='character varying' then 'varchar(' || c.character_maximum_length || ')'
         when c.data_type='numeric' and c.numeric_precision is not null then 'numeric(' || c.numeric_precision || ',' || coalesce(c.numeric_scale,0) || ')'
         else c.data_type
       end as typ,
       c.is_nullable='YES' as is_nullable,
       c.column_default
from information_schema.columns c
where c.table_schema='public' and c.table_name=$1
order by c.ordinal_position`
	rows, err := pool.Query(ctx, q, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []columnDef
	for rows.Next() {
		var cd columnDef
		var isNullable bool
		if err := rows.Scan(&cd.Name, &cd.Type, &isNullable, &cd.Default); err != nil {
			return nil, err
		}
		cd.IsNullable = isNullable
		out = append(out, cd)
	}
	return out, rows.Err()
}

func streamInserts(ctx context.Context, pool *pgxpool.Pool, w *bufio.Writer, table string, onBatch func(rowsExported int64)) (int64, error) {
	cols, err := getColumns(ctx, pool, table)
	if err != nil {
		return 0, err
	}
	colNames := make([]string, len(cols))
	for i, c := range cols {
		colNames[i] = c.Name
	}
	selectSQL := fmt.Sprintf(`select %s from %s`, joinQuoted(colNames), quoteIdent(table))
	rows, err := pool.Query(ctx, selectSQL)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	const batchSize = 500
	var (
		totalRows int64
		batchCnt  int
		valBuf    []string
	)
	scanHolders := make([]any, len(cols))
	for i := range scanHolders {
		var anyval any
		scanHolders[i] = &anyval
	}

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return totalRows, err
		}
		valBuf = append(valBuf, tupleToSQL(values))
		batchCnt++
		totalRows++

		if batchCnt >= batchSize {
			if err := writeInsert(w, table, colNames, valBuf); err != nil {
				return totalRows, err
			}
			valBuf = valBuf[:0]
			batchCnt = 0
			if onBatch != nil {
				onBatch(totalRows)
			}
			if err := w.Flush(); err != nil {
				return totalRows, err
			}
		}
	}
	if rows.Err() != nil {
		return totalRows, rows.Err()
	}
	if batchCnt > 0 {
		if err := writeInsert(w, table, colNames, valBuf); err != nil {
			return totalRows, err
		}
		if onBatch != nil {
			onBatch(totalRows)
		}
	}
	return totalRows, nil
}

func writeInsert(w *bufio.Writer, table string, cols []string, tuples []string) error {
	if len(tuples) == 0 {
		return nil
	}
	fmt.Fprintf(w, "INSERT INTO %s (%s) VALUES\n", quoteIdent(table), joinQuoted(cols))
	for i, t := range tuples {
		sep := ","
		if i == len(tuples)-1 {
			sep = ";"
		}
		fmt.Fprintf(w, "  %s%s\n", t, sep)
	}
	return nil
}

func quoteIdent(id string) string {
	return `"` + strings.ReplaceAll(id, `"`, `""`) + `"`
}

func joinQuoted(names []string) string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = quoteIdent(n)
	}
	return strings.Join(out, ", ")
}

func tupleToSQL(vals []any) string {
	out := make([]string, len(vals))
	for i, v := range vals {
		out[i] = literal(v)
	}
	return "(" + strings.Join(out, ", ") + ")"
}

func literal(v any) string {
	if v == nil {
		return "NULL"
	}
	switch t := v.(type) {
	case string:
		return "'" + strings.ReplaceAll(t, `'`, `''`) + "'"
	case []byte:
		return fmt.Sprintf(`E'\\x%x'`, t)
	case bool:
		if t {
			return "TRUE"
		}
		return "FALSE"
	case int8, int16, int32, int64, int:
		return fmt.Sprintf("%d", t)
	case uint8, uint16, uint32, uint64, uint:
		return fmt.Sprintf("%d", t)
	case float32:
		if math.IsNaN(float64(t)) || math.IsInf(float64(t), 0) {
			return "NULL"
		}
		return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", t), "0"), ".")
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return "NULL"
		}
		return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", t), "0"), ".")
	case time.Time:
		return "'" + t.UTC().Format(time.RFC3339Nano) + "'"
	case pgtype.Numeric:
		if t.NaN {
			return "NULL"
		}
		intStr := t.Int.String()
		exp := int(t.Exp)
		neg := strings.HasPrefix(intStr, "-")
		if neg {
			intStr = intStr[1:]
		}
		var out string
		if exp >= 0 {
			out = intStr + strings.Repeat("0", exp)
		} else {
			pointPos := len(intStr) + exp
			if pointPos > 0 {
				out = intStr[:pointPos] + "." + intStr[pointPos:]
			} else {
				out = "0." + strings.Repeat("0", -pointPos) + intStr
			}
		}
		if neg && out != "0" {
			out = "-" + out
		}
		return out
	default:
		switch x := t.(type) {
		case sql.NullString:
			if !x.Valid {
				return "NULL"
			}
			return "'" + strings.ReplaceAll(x.String, `'`, `''`) + "'"
		case sql.NullInt64:
			if !x.Valid {
				return "NULL"
			}
			return fmt.Sprintf("%d", x.Int64)
		case sql.NullBool:
			if !x.Valid {
				return "NULL"
			}
			if x.Bool {
				return "TRUE"
			}
			return "FALSE"
		case sql.NullFloat64:
			if !x.Valid {
				return "NULL"
			}
			return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", x.Float64), "0"), ".")
		default:
			return "'" + strings.ReplaceAll(fmt.Sprintf("%v", t), `'`, `''`) + "'"
		}
	}
}
