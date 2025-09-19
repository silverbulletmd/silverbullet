package server

import (
	"context"
	"net/http"
)

const spaceConfigKey = "spaceConfig"
const serverConfigKey = "serverConfig"

func spaceMiddleware(config *ServerConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			spaceConfig := config.SpaceConfigResolver(r)
			ctx := context.WithValue(r.Context(), spaceConfigKey, spaceConfig)
			ctx = context.WithValue(ctx, serverConfigKey, config)
			augmentedRequest := r.WithContext(ctx)
			next.ServeHTTP(w, augmentedRequest)
		})
	}
}

func spaceConfigFromContext(ctx context.Context) *SpaceConfig {
	return ctx.Value(spaceConfigKey).(*SpaceConfig)
}

func serverConfigFromContext(ctx context.Context) *ServerConfig {
	return ctx.Value(serverConfigKey).(*ServerConfig)
}
