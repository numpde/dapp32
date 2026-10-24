FROM ghcr.io/nginx/nginx-unprivileged:1.31.1-alpine3.23@sha256:8122337ed6c475bb486bc9340da453d4599f225e6b920ff0d92ca2267486b9b5

LABEL org.opencontainers.image.source="https://github.com/numpde/dapp32"

COPY nginx.conf /etc/nginx/nginx.conf
COPY site/ /srv/viewer/
USER 101:101
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
