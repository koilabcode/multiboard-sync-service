package database

import "os"

const (
	DBNameProduction = "production"
	DBNameStaging    = "staging"
	DBNameDev        = "dev"
)

type URLs struct {
	Production string
	Staging    string
	Dev        string
}

func LoadURLs() URLs {
	return URLs{
		Production: os.Getenv("PRODUCTION_DATABASE_URL"),
		Staging:    os.Getenv("STAGING_DATABASE_URL"),
		Dev:        os.Getenv("DEV_DATABASE_URL"),
	}
}

func (u URLs) ListConfigured() []string {
	out := make([]string, 0, 3)
	if u.Production != "" {
		out = append(out, DBNameProduction)
	}
	if u.Staging != "" {
		out = append(out, DBNameStaging)
	}
	if u.Dev != "" {
		out = append(out, DBNameDev)
	}
	return out
}

func (u URLs) Get(name string) (string, bool) {
	switch name {
	case DBNameProduction:
		if u.Production == "" {
			return "", false
		}
		return u.Production, true
	case DBNameStaging:
		if u.Staging == "" {
			return "", false
		}
		return u.Staging, true
	case DBNameDev:
		if u.Dev == "" {
			return "", false
		}
		return u.Dev, true
	default:
		return "", false
	}
}
