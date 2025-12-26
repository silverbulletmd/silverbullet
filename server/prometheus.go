package server

import (
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var httpRequestsTotal = prometheus.NewCounter(
	prometheus.CounterOpts{
		Name: "silverbullet_http_requests",
		Help: "Total number of HTTP requests to SilverBullet",
	},
)

func init() {
	prometheus.MustRegister(httpRequestsTotal)
}

func httpStatsMiddleware(config *ServerConfig) func(http.Handler) http.Handler {
	if config.MetricsPort == 0 {
		// NOOP
		return func(next http.Handler) http.Handler {
			return next
		}
	} else {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				httpRequestsTotal.Inc()
				next.ServeHTTP(w, r)
			})
		}
	}
}

func runMetricsServer(config *ServerConfig) *http.Server {
	if config.MetricsPort == 0 {
		return nil
	}

	metricRouter := chi.NewRouter()
	metricsServer := &http.Server{
		Addr:    fmt.Sprintf("%s:%d", config.BindHost, config.MetricsPort),
		Handler: metricRouter,
	}
	metricRouter.Handle("/metrics", promhttp.Handler())

	go func() {
		log.Printf("Metrics server started on %s:%d", config.BindHost, config.MetricsPort)
		if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Metrics server error: %v", err)
		}
	}()

	return metricsServer
}
