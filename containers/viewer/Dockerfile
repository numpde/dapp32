FROM ghcr.io/nginx/nginx-unprivileged:1.31.1-alpine3.23@sha256:8122337ed6c475bb486bc9340da453d4599f225e6b920ff0d92ca2267486b9b5

# The upstream revision describes nginx. These facts identify the viewer bytes
# and let its updater retire only images produced for this runtime.
ARG VIEWER_REVISION
ARG VIEWER_MODIFIED
ARG VIEWER_PROJECT
LABEL org.opencontainers.image.source="https://github.com/numpde/dapp32" \
      org.opencontainers.image.revision="${VIEWER_REVISION}" \
      com.cam.viewer.modified="${VIEWER_MODIFIED}" \
      com.cam.viewer.project="${VIEWER_PROJECT}" \
      com.cam.role="viewer"

# Build staging may use a restrictive host umask. Publication modes belong to
# the image so its non-root runtime can always read configuration and assets.
COPY --chmod=0644 nginx.conf /etc/nginx/nginx.conf
# Older BuildKit applies conditional directory traversal only with the +X form.
COPY --chmod=u=rw,u+X,go=r,go+X site/ /srv/viewer/
USER 101:101
# Fail during the offline build if this user cannot load the packaged config.
RUN ["nginx", "-t"]
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
