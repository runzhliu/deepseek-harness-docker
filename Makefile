IMAGE ?= runzhliu/deepseek-harness
VERSION ?= 0.1.0-rc.6
PLATFORMS ?= linux/amd64,linux/arm64

.PHONY: help build multiarch-build pull up down logs compose-check helm-check plugin-check verify smoke inspect

help:
	@echo "build            Build the local platform image"
	@echo "multiarch-build  Build both release platforms without pushing"
	@echo "pull             Pull the published image"
	@echo "up/down/logs     Manage the Compose service"
	@echo "verify           Validate Compose and Helm rendering"
	@echo "plugin-check     Validate and dry-pack the browser plugin"
	@echo "smoke            Exercise CLI, config, PTY, and Web startup"
	@echo "inspect          Inspect the remote multi-platform manifest"

build:
	docker build --pull --build-arg DSH_VERSION=$(VERSION) --tag $(IMAGE):$(VERSION) .

multiarch-build:
	docker buildx build --platform $(PLATFORMS) --build-arg DSH_VERSION=$(VERSION) --tag $(IMAGE):$(VERSION) .

pull:
	docker pull $(IMAGE):$(VERSION)

up:
	docker compose up --detach --no-build

down:
	docker compose down

logs:
	docker compose logs --follow deepseek-harness

compose-check:
	docker compose config --quiet

helm-check:
	helm lint --strict charts/deepseek-harness
	helm template deepseek-harness charts/deepseek-harness >/dev/null
	helm template deepseek-harness charts/deepseek-harness --set persistence.enabled=false --set credentials.existingSecret=dsh-provider-credentials --set workspace.existingClaim=dsh-workspace >/dev/null

plugin-check:
	node --check plugins/dsh-browser-desktop/index.js
	node --check plugins/dsh-browser-desktop/client.js
	npm --cache "$${TMPDIR:-/tmp}/dsh-browser-plugin-npm-cache" pack --dry-run --json ./plugins/dsh-browser-desktop >/dev/null

verify: compose-check helm-check plugin-check

smoke:
	./scripts/smoke.sh $(IMAGE):$(VERSION) $(VERSION)

inspect:
	docker buildx imagetools inspect $(IMAGE):$(VERSION)
