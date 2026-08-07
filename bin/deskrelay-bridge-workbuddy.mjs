#!/usr/bin/env node

import { runJsEntry } from "./_run-entry.mjs";

runJsEntry("dist/bridge/deskrelay-bridge.js", ["--adapter", "workbuddy"]);
