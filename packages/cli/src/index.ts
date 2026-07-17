#!/usr/bin/env node
// ABOUTME: Entry point for the beans CLI — admin commands over the Cool Beans HTTP API.
// ABOUTME: Subcommands (product, key, stripe) land with the CLI issue; spec in docs/PRD.md §16.

import { Command } from 'commander';

const program = new Command();

program
	.name('beans')
	.description('Cool Beans admin CLI — issue a key, activate it, check it is still good.')
	.version('0.0.0');

program.parse();
