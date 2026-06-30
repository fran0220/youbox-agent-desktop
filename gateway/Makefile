.PHONY: build run test clean

build:
	go build -o bin/gateway ./cmd/gateway

run: build
	./bin/gateway -config gateway.yaml

test:
	go test ./...

clean:
	rm -rf bin/
