IMAGE ?= runzhliu/deepseek-harness
VERSION ?= 0.1.1-rc.2
DSH_VERSION ?= $(VERSION)
NODE_IMAGE ?= node:24-trixie
DSH_MARKET_VERSION ?= 1.21.0
MARKET_IMAGE_VERSION ?= $(VERSION)-market.1
PLATFORMS ?= linux/amd64,linux/arm64

.PHONY: help build multiarch-build push pull market-build market-push market-pull up down logs compose-check helm-check plugin-check verify smoke market-smoke inspect market-inspect

help:
	@echo "build            Build the local platform image"
	@echo "multiarch-build  Build both release platforms without pushing"
	@echo "push             Build and push the versioned multi-platform image"
	@echo "pull             Pull the published image"
	@echo "market-build     Build the optional community-market image"
	@echo "market-push      Build and push its versioned multi-platform image"
	@echo "up/down/logs     Manage the Compose service"
	@echo "verify           Validate Compose and Helm rendering"
	@echo "plugin-check     Validate and dry-pack the browser plugin"
	@echo "smoke            Exercise CLI, config, PTY, and Web startup"
	@echo "inspect          Inspect the remote multi-platform manifest"

build:
	docker build --pull --build-arg DSH_VERSION=$(DSH_VERSION) --build-arg NODE_IMAGE=$(NODE_IMAGE) --tag $(IMAGE):$(VERSION) .

multiarch-build:
	docker buildx build --platform $(PLATFORMS) --build-arg DSH_VERSION=$(DSH_VERSION) --build-arg NODE_IMAGE=$(NODE_IMAGE) --tag $(IMAGE):$(VERSION) .

push:
	docker buildx build --platform $(PLATFORMS) --build-arg DSH_VERSION=$(DSH_VERSION) --build-arg NODE_IMAGE=$(NODE_IMAGE) --tag $(IMAGE):$(VERSION) --push .

pull:
	docker pull $(IMAGE):$(VERSION)

market-build:
	docker build --pull --file Dockerfile.market --build-arg BASE_IMAGE=$(IMAGE):$(VERSION) --build-arg NODE_IMAGE=$(NODE_IMAGE) --build-arg DSH_MARKET_VERSION=$(DSH_MARKET_VERSION) --build-arg MARKET_IMAGE_VERSION=$(MARKET_IMAGE_VERSION) --tag $(IMAGE):$(MARKET_IMAGE_VERSION) .

market-push:
	docker buildx build --platform $(PLATFORMS) --file Dockerfile.market --build-arg BASE_IMAGE=$(IMAGE):$(VERSION) --build-arg NODE_IMAGE=$(NODE_IMAGE) --build-arg DSH_MARKET_VERSION=$(DSH_MARKET_VERSION) --build-arg MARKET_IMAGE_VERSION=$(MARKET_IMAGE_VERSION) --tag $(IMAGE):$(MARKET_IMAGE_VERSION) --push .

market-pull:
	docker pull $(IMAGE):$(MARKET_IMAGE_VERSION)

up:
	docker compose up --detach --no-build

down:
	docker compose down

logs:
	docker compose logs --follow deepseek-harness

compose-check:
	docker compose config --quiet
	docker compose -f compose.yaml -f compose.market.yaml config --quiet

helm-check:
	helm lint --strict charts/deepseek-harness
	helm template deepseek-harness charts/deepseek-harness >/dev/null
	helm template deepseek-harness charts/deepseek-harness --set persistence.enabled=false --set credentials.existingSecret=dsh-provider-credentials --set workspace.existingClaim=dsh-workspace >/dev/null

plugin-check:
	node --check plugins/dsh-browser-desktop/index.js
	node --check plugins/dsh-browser-desktop/client.js
	node --check scripts/dsh-market-repair-store
	sh -n scripts/deepseek-harness-entrypoint
	sh -n scripts/deepseek-harness-market-entrypoint
	bash -n scripts/smoke.sh
	npm --cache "$${TMPDIR:-/tmp}/dsh-browser-plugin-npm-cache" pack --dry-run --json ./plugins/dsh-browser-desktop >/dev/null

verify: compose-check helm-check plugin-check

smoke:
	./scripts/smoke.sh $(IMAGE):$(VERSION) $(DSH_VERSION) 10.15.1

market-smoke:
	./scripts/smoke.sh $(IMAGE):$(MARKET_IMAGE_VERSION) $(DSH_VERSION) 10.15.1 $(DSH_MARKET_VERSION)

inspect:
	docker buildx imagetools inspect $(IMAGE):$(VERSION)

market-inspect:
	docker buildx imagetools inspect $(IMAGE):$(MARKET_IMAGE_VERSION)
