IMAGE ?= runzhliu/deepseek-harness
GHCR_IMAGE ?= ghcr.io/runzhliu/deepseek-harness
DSH_VERSION ?= 0.1.2-rc.1
IMAGE_VERSION ?= $(DSH_VERSION)-r1
NODE_IMAGE ?= node:24-trixie
PNPM_VERSION ?= 10.15.1
DSH_MARKET_VERSION ?= 1.38.1
MARKET_IMAGE_VERSION ?= $(IMAGE_VERSION)-market.1
BROWSER_PLUGIN_VERSION ?= 0.1.2
PLATFORMS ?= linux/amd64,linux/arm64

.PHONY: help build multiarch-build push pull ghcr-pull market-build market-push market-pull up down logs compose-check helm-check plugin-check dockerhub-check version-check verify upstream-check smoke market-smoke inspect ghcr-inspect market-inspect

help:
	@echo "build            Build the local platform image"
	@echo "multiarch-build  Build both release platforms without pushing"
	@echo "push             Build and push the versioned multi-platform image"
	@echo "pull             Pull the published image"
	@echo "ghcr-pull        Pull the GHCR mirror of the published image"
	@echo "market-build     Build the optional community-market image"
	@echo "market-push      Build and push its versioned multi-platform image"
	@echo "up/down/logs     Manage the Compose service"
	@echo "verify           Validate Compose and Helm rendering"
	@echo "plugin-check     Validate and dry-pack the browser plugin"
	@echo "dockerhub-check  Render and validate the Docker Hub overview"
	@echo "version-check    Verify pinned versions across build and deployment files"
	@echo "upstream-check   Compare the pinned DSH version with GitHub and npm"
	@echo "smoke            Exercise CLI, config, PTY, and Web startup"
	@echo "inspect          Inspect the remote multi-platform manifest"

build:
	docker build --pull --build-arg DSH_VERSION=$(DSH_VERSION) --build-arg IMAGE_VERSION=$(IMAGE_VERSION) --build-arg IMAGE_REVISION=$$(git describe --always --dirty) --build-arg NODE_IMAGE=$(NODE_IMAGE) --build-arg PNPM_VERSION=$(PNPM_VERSION) --tag $(IMAGE):$(IMAGE_VERSION) .

multiarch-build:
	docker buildx build --platform $(PLATFORMS) --build-arg DSH_VERSION=$(DSH_VERSION) --build-arg IMAGE_VERSION=$(IMAGE_VERSION) --build-arg IMAGE_REVISION=$$(git describe --always --dirty) --build-arg NODE_IMAGE=$(NODE_IMAGE) --build-arg PNPM_VERSION=$(PNPM_VERSION) --tag $(IMAGE):$(IMAGE_VERSION) .

push:
	@if docker buildx imagetools inspect $(IMAGE):$(IMAGE_VERSION) >/dev/null 2>&1; then echo "refusing to overwrite existing image tag: $(IMAGE):$(IMAGE_VERSION)" >&2; exit 1; fi
	docker buildx build --platform $(PLATFORMS) --build-arg DSH_VERSION=$(DSH_VERSION) --build-arg IMAGE_VERSION=$(IMAGE_VERSION) --build-arg IMAGE_REVISION=$$(git describe --always --dirty) --build-arg NODE_IMAGE=$(NODE_IMAGE) --build-arg PNPM_VERSION=$(PNPM_VERSION) --tag $(IMAGE):$(IMAGE_VERSION) --push .

pull:
	docker pull $(IMAGE):$(IMAGE_VERSION)

ghcr-pull:
	docker pull $(GHCR_IMAGE):$(IMAGE_VERSION)

market-build:
	docker build --pull --file Dockerfile.market --build-arg BASE_IMAGE=$(IMAGE):$(IMAGE_VERSION) --build-arg NODE_IMAGE=$(NODE_IMAGE) --build-arg DSH_MARKET_VERSION=$(DSH_MARKET_VERSION) --build-arg MARKET_IMAGE_VERSION=$(MARKET_IMAGE_VERSION) --tag $(IMAGE):$(MARKET_IMAGE_VERSION) .

market-push:
	@if docker buildx imagetools inspect $(IMAGE):$(MARKET_IMAGE_VERSION) >/dev/null 2>&1; then echo "refusing to overwrite existing image tag: $(IMAGE):$(MARKET_IMAGE_VERSION)" >&2; exit 1; fi
	docker buildx build --platform $(PLATFORMS) --file Dockerfile.market --build-arg BASE_IMAGE=$(IMAGE):$(IMAGE_VERSION) --build-arg NODE_IMAGE=$(NODE_IMAGE) --build-arg DSH_MARKET_VERSION=$(DSH_MARKET_VERSION) --build-arg MARKET_IMAGE_VERSION=$(MARKET_IMAGE_VERSION) --tag $(IMAGE):$(MARKET_IMAGE_VERSION) --push .

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
	bash -n scripts/check-upstream-dsh.sh
	bash -n scripts/check-version-consistency.sh
	bash -n scripts/smoke.sh
	npm --cache "$${TMPDIR:-/tmp}/dsh-browser-plugin-npm-cache" pack --dry-run --json ./plugins/dsh-browser-desktop >/dev/null

dockerhub-check:
	bash -n scripts/render-dockerhub-readme.sh
	bash scripts/render-dockerhub-readme.sh README.md /dev/null

version-check:
	./scripts/check-version-consistency.sh $(DSH_VERSION) $(IMAGE_VERSION) $(PNPM_VERSION) $(DSH_MARKET_VERSION) $(MARKET_IMAGE_VERSION) $(BROWSER_PLUGIN_VERSION)

verify: compose-check helm-check plugin-check dockerhub-check version-check

upstream-check:
	./scripts/check-upstream-dsh.sh $(DSH_VERSION)

smoke:
	./scripts/smoke.sh $(IMAGE):$(IMAGE_VERSION) $(DSH_VERSION) $(PNPM_VERSION)

market-smoke:
	./scripts/smoke.sh $(IMAGE):$(MARKET_IMAGE_VERSION) $(DSH_VERSION) $(PNPM_VERSION) $(DSH_MARKET_VERSION)

inspect:
	docker buildx imagetools inspect $(IMAGE):$(IMAGE_VERSION)

ghcr-inspect:
	docker buildx imagetools inspect $(GHCR_IMAGE):$(IMAGE_VERSION)

market-inspect:
	docker buildx imagetools inspect $(IMAGE):$(MARKET_IMAGE_VERSION)
