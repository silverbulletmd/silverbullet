package server

import (
	"context"
	"net/http"
)

const spaceConfigKey = "spaceConfig"

func spaceMiddleware(config *ServerConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			spaceConfig := config.SpaceConfigResolver(r)
			augmentedRequest := r.WithContext(context.WithValue(r.Context(), spaceConfigKey, spaceConfig))
			next.ServeHTTP(w, augmentedRequest)
		})
	}
}

func spaceConfigFromContext(ctx context.Context) *SpaceConfig {
	return ctx.Value(spaceConfigKey).(*SpaceConfig)
}
