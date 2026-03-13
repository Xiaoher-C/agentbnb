#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('agentbnb')
  .description('P2P Agent Capability Sharing Protocol — Airbnb for AI agent pipelines')
  .version('0.0.1');

program
  .command('init')
  .description('Initialize AgentBnB config in current directory')
  .action(() => {
    console.log('🏠 AgentBnB initialized. Ready to list your agent capabilities.');
  });

program
  .command('publish <card>')
  .description('Publish a Capability Card to the registry')
  .action((card: string) => {
    console.log(`📋 Publishing capability card: ${card}`);
  });

program
  .command('discover [query]')
  .description('Search available capabilities')
  .action((query?: string) => {
    console.log(`🔍 Discovering capabilities${query ? `: ${query}` : '...'}`);
  });

program
  .command('request <card-id>')
  .description('Request a capability from another agent')
  .action((cardId: string) => {
    console.log(`📨 Requesting capability: ${cardId}`);
  });

program
  .command('status')
  .description('Show credit balance and active requests')
  .action(() => {
    console.log('💰 Credit balance: 100 (starter grant)');
  });

program
  .command('serve')
  .description('Start the AgentBnB gateway server')
  .action(() => {
    console.log('🚀 Starting AgentBnB gateway on port 7700...');
  });

program.parse();
