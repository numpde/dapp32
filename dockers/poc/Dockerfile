# Dockerfile

# Base image: Node.js LTS (Long Term Support)
FROM node:lts as dapp32_poc_build

# Create a directory for the application
WORKDIR /usr/src/app/

# Arguments for Git
ARG GITHUB_ACCESS_TOKEN
ARG GITHUB_REPO

# Clone the git repo
RUN git clone https://${GITHUB_ACCESS_TOKEN}@github.com/${GITHUB_REPO} .

# Switch to the directory
WORKDIR /usr/src/app/poc/dapp32-nx

# Install dependencies, apply patches, build the project and clean up
RUN npm install -g patch-package && \
    npm install && \
    npx patch-package && \
    npx nx build dapp32-nx && \
    npm cache clean --force && \
    npm prune

# Final stage
FROM node:lts

# Copy build directory
WORKDIR /usr/src/app/
COPY --from=dapp32_poc_build /usr/src/app/poc/dapp32-nx .

# Environment variables for Port
ARG PORT=4001
ENV PORT ${PORT}

# Expose Port
EXPOSE ${PORT}

# Start the server
CMD ["sh", "-c", "npx nx serve dapp32-nx --prod --port ${PORT} --hostname 0.0.0.0" ]
