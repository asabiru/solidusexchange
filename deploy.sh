#!/bin/bash
# Deploy script for Solidus Exchange
# Server: 77.222.61.245
# User: wabeitvkco

echo "Deploying to server..."

ssh -o StrictHostKeyChecking=no wabeitvkco@77.222.61.245 << 'ENDSSH'
cd /var/www/solidusexchange
git pull origin master
php artisan cache:clear
php artisan config:clear
php artisan view:clear
echo "Deployment completed successfully!"
ENDSSH