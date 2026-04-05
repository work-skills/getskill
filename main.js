#!/usr/bin/env node

const main = require('./dist/main.js');

module.exports = main;

if (require.main === module) {
    void main.cli();
}
