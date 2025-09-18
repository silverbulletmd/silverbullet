build:
	# Build frontend
	deno task build-frontend
	# Build backend
	go build

check:
	# Frontend type check
	deno task check
	# Frontend lint
	deno task lint
	# Backend lint
	go vet

fmt:
	# Reformat frontend
	deno task fmt
	# Reformat backend
	go fmt

test:
	# Run frontend tests
	deno task test
	# Run backend tests
	go test ./pkg/...
