#!/usr/bin/env node
// Consort CLI entrypoint. Full dispatch table lands in Plan 02.
const [, , sub] = process.argv;
process.stderr.write(`consort: subcommand '${sub ?? ""}' not yet implemented\n`);
process.exit(2);
