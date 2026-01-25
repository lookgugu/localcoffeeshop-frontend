#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Load .env file if it exists
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=:#]+)=(.*)$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2];
        }
    });
}

const API_BASE_URL = process.env.API_BASE_URL || '/api/v1';
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';
const ENVIRONMENT = process.env.NODE_ENV || 'production';

const configContent = `// Auto-generated configuration - DO NOT EDIT MANUALLY
// Generated at: ${new Date().toISOString()}
window.APP_CONFIG = {
    API_BASE_URL: '${API_BASE_URL}',
    GA_MEASUREMENT_ID: '${GA_MEASUREMENT_ID}',
    ENVIRONMENT: '${ENVIRONMENT}'
};
`;

const outputPath = path.join(__dirname, '../public/config.js');
fs.writeFileSync(outputPath, configContent);
console.log('✅ Configuration injected:', { API_BASE_URL, ENVIRONMENT });
