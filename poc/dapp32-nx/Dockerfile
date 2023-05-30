# Dockerfile

# Base image: Node.js LTS (Long Term Support)
FROM node:lts

# Create a directory for the application
WORKDIR /usr/src/app

# Copy package.json, package-lock.json (if you use it) to the root directory of the app
COPY package*.json ./

# Install dependencies
RUN npm install

# Bundle app source
COPY . .

# Build the application
RUN npm run build

# Port
EXPOSE 4001

# The default command to run
CMD [ "nx", "serve", "dapp32-nx", "--port", "4001" ]
