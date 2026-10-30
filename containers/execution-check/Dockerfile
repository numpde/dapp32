FROM docker.io/library/golang:1.27.3-bookworm@sha256:d9b6a1beb9474adc2a1ce842573639b44b2a0dd49b6669f51d3821baf9ec37c9 AS go
FROM docker.io/library/node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

COPY --from=go /usr/local/go /usr/local/go
COPY --from=node-workspace stage-node-modules stage-js-workspace run-js-workspace /usr/local/bin/
COPY run-execution-check /usr/local/bin/
RUN chmod 0755 /usr/local/bin/run-execution-check /usr/local/bin/run-js-workspace /usr/local/bin/stage-js-workspace /usr/local/bin/stage-node-modules
ENV PATH="/usr/local/go/bin:${PATH}"
