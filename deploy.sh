#!/bin/bash
# Deploy script for Solidus Exchange
# Server: 77.222.61.245
# User: wabeitvkco

echo "Deploying to server..."

ssh solidus << 'ENDSSH'
cd ~/solidus/public_html
git pull origin master
php8.2 artisan cache:clear
php8.2 artisan config:clear
php8.2 artisan view:clear
echo "Deployment completed successfully!"
ENDSSH