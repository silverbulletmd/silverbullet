build:
	# Build frontend
	deno task build-frontend
	# Build backend
	go build

check:
	deno task check
	deno task lint
	go vet

fmt:
	deno task fmt
	go fmt

test:
	# Run frontend tests
	deno task test
	# Run backend tests
	go test ./pkg/...
