FROM docker.io/library/node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

WORKDIR /app
COPY package.json /app/package.json
COPY tools/ /app/tools/
COPY node_modules/ /app/node_modules/

RUN chmod -R a=rX /app

USER 65532:65532
RUN node --experimental-strip-types --input-type=module -e "await import('/app/tools/release-approval/run.ts')"
ENTRYPOINT ["node", "--experimental-strip-types", "/app/tools/release-approval/run.ts"]
