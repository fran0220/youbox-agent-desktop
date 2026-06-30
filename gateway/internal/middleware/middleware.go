package middleware

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

type contextKey string

const RequestIDKey contextKey = "request_id"

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			b := make([]byte, 8)
			rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), RequestIDKey, id)
		r = r.WithContext(ctx)

		logger := log.With().Str("request_id", id).Logger()
		ctx = logger.WithContext(ctx)
		r = r.WithContext(ctx)

		next.ServeHTTP(w, r)
	})
}

func GetRequestID(ctx context.Context) string {
	if id, ok := ctx.Value(RequestIDKey).(string); ok {
		return id
	}
	return ""
}

type responseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}

func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := rw.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("upstream ResponseWriter does not implement http.Hijacker")
}

// ErrorCallback is called for server errors (5xx) and panics.
type ErrorCallback func(event string, properties map[string]interface{})

func RequestLog(next http.Handler) http.Handler {
	return RequestLogWithCallback(next, nil)
}

func RequestLogWithCallback(next http.Handler, onError ErrorCallback) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip noisy health checks
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)

		latency := time.Since(start)
		logger := zerolog.Ctx(r.Context())
		logger.Info().
			Str("method", r.Method).
			Str("path", r.URL.Path).
			Int("status", rw.status).
			Int("size", rw.size).
			Dur("latency", latency).
			Str("remote", r.RemoteAddr).
			Msg("request")

		if onError != nil && rw.status >= 500 {
			onError("server_error", map[string]interface{}{
				"method":     r.Method,
				"path":       r.URL.Path,
				"status":     rw.status,
				"latency_ms": latency.Milliseconds(),
				"request_id": GetRequestID(r.Context()),
			})
		}
	})
}

func PanicRecovery(next http.Handler) http.Handler {
	return PanicRecoveryWithCallback(next, nil)
}

func PanicRecoveryWithCallback(next http.Handler, onError ErrorCallback) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				logger := zerolog.Ctx(r.Context())
				logger.Error().
					Interface("panic", err).
					Str("method", r.Method).
					Str("path", r.URL.Path).
					Msg("panic recovered")
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)

				if onError != nil {
					onError("panic", map[string]interface{}{
						"method":     r.Method,
						"path":       r.URL.Path,
						"error":      fmt.Sprintf("%v", err),
						"request_id": GetRequestID(r.Context()),
					})
				}
			}
		}()
		next.ServeHTTP(w, r)
	})
}
