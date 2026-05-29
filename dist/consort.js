#!/usr/bin/env node
"use strict";

// src/consort.ts
var [, , sub] = process.argv;
process.stderr.write(`consort: subcommand '${sub ?? ""}' not yet implemented
`);
process.exit(2);
