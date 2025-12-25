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
			spaceConfig, err := config.SpaceConfigResolver(r)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			ctx := context.WithValue(r.Context(), spaceConfigKey, spaceConfig)
			ctx = context.WithValue(ctx, serverConfigKey, config)
			augmentedRequest := r.WithContext(ctx)
			next.ServeHTTP(w, augmentedRequest)
		})
	}
}

func spaceConfigFromContext(ctx context.Context) (*SpaceConfig, bool) {
	cfg, ok := ctx.Value(spaceConfigKey).(*SpaceConfig)
	return cfg, ok
}

func serverConfigFromContext(ctx context.Context) (*ServerConfig, bool) {
	cfg, ok := ctx.Value(serverConfigKey).(*ServerConfig)
	return cfg, ok
}
