FROM node:22-slim

ENV CI=true
# Commit SHA, reported as the OpenTelemetry service.version (src/otel.js)
ARG SERVICE_VERSION=unknown
ENV SERVICE_VERSION=${SERVICE_VERSION}
# Create app directory
WORKDIR /home/app

COPY . ./

COPY ./package*.json ./

#RUN git submodule init
#RUN git submodule update
#RUN cd ./src/modules/react-joyride && npm run build

RUN npm install -g pnpm@10.27.0

RUN pnpm install


ENTRYPOINT ./start.sh
