# syntax=docker/dockerfile:1.19
FROM docker.io/library/node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

WORKDIR /app
COPY package.json /app/package.json
COPY tools/ /app/tools/
COPY node_modules/ /app/node_modules/

USER 65532:65532
ENTRYPOINT ["node", "--experimental-strip-types", "/app/tools/release-approval/run.ts"]
