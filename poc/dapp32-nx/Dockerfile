# Dockerfile

# Base image: Node.js LTS (Long Term Support)
FROM node:lts

# Create a directory for the application
WORKDIR /usr/src/app/

# Copy package.json, package-lock.json (if you use it) to the root directory of the app
COPY package*.json ./

# Install dependencies
RUN npm install

# Bundle app source
COPY . .

# Build the application
RUN npx nx build dapp32-nx

# Port
EXPOSE 4001

# The default command to run
CMD [ "npx", "nx", "serve", "dapp32-nx", "--prod", "--port", "4001", "--hostname", "0.0.0.0" ]
