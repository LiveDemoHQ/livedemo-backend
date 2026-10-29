#!/bin/bash

#npm run bundle
node --import ./src/otel.js -r @esbuild-kit/cjs-loader ./src/server.js
