#!/bin/bash

# Solidus Exchange Deployment Script
# This script deploys the latest changes from GitHub to the hosting server

# Configuration - Update these values
SSH_HOST="your-host.com"
SSH_USER="username"
SSH_PASSWORD="09087691sS!"
DEPLOY_PATH="/var/www/solidusexchange"
GIT_REPO="https://github.com/asabiru/solidusexchange.git"
BRANCH="master"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Solidus Exchange deployment...${NC}"

# Function to execute SSH commands
ssh_exec() {
    sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" "$1"
}

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    echo -e "${RED}sshpass is not installed. Installing...${NC}"
    # For Ubuntu/Debian
    sudo apt-get update && sudo apt-get install -y sshpass
    # For CentOS/RHEL
    # sudo yum install -y sshpass
fi

# 1. Backup current deployment
echo -e "${YELLOW}Creating backup...${NC}"
ssh_exec "cd $DEPLOY_PATH && tar -czf ../backup_$(date +%Y%m%d_%H%M%S).tar.gz ."

# 2. Pull latest changes
echo -e "${YELLOW}Pulling latest changes from GitHub...${NC}"
ssh_exec "cd $DEPLOY_PATH && git fetch origin && git checkout $BRANCH && git pull origin $BRANCH"

# 3. Install dependencies
echo -e "${YELLOW}Installing PHP dependencies...${NC}"
ssh_exec "cd $DEPLOY_PATH && composer install --no-dev --optimize-autoloader"

echo -e "${YELLOW}Installing Node dependencies...${NC}"
ssh_exec "cd $DEPLOY_PATH && npm install && npm run build"

# 4. Run migrations
echo -e "${YELLOW}Running database migrations...${NC}"
ssh_exec "cd $DEPLOY_PATH && php artisan migrate --force"

# 5. Clear caches
echo -e "${YELLOW}Clearing application caches...${NC}"
ssh_exec "cd $DEPLOY_PATH && php artisan cache:clear"
ssh_exec "cd $DEPLOY_PATH && php artisan config:clear"
ssh_exec "cd $DEPLOY_PATH && php artisan route:clear"
ssh_exec "cd $DEPLOY_PATH && php artisan view:clear"

# 6. Set permissions
echo -e "${YELLOW}Setting proper permissions...${NC}"
ssh_exec "cd $DEPLOY_PATH && chown -R www-data:www-data storage bootstrap/cache"
ssh_exec "cd $DEPLOY_PATH && chmod -R 775 storage bootstrap/cache"

# 7. Restart services
echo -e "${YELLOW}Restarting services...${NC}"
ssh_exec "sudo systemctl restart nginx"
ssh_exec "sudo systemctl restart php-fpm"  # Adjust based on your PHP version
# ssh_exec "sudo systemctl restart supervisor"  # If using queue workers

# 8. Health check
echo -e "${YELLOW}Performing health check...${NC}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://your-domain.com)
if [ $HTTP_STATUS -eq 200 ]; then
    echo -e "${GREEN}Deployment successful! Site is responding with HTTP $HTTP_STATUS${NC}"
else
    echo -e "${RED}Warning: Site returned HTTP $HTTP_STATUS${NC}"
fi

echo -e "${GREEN}Deployment completed!${NC}"

# Optional: Rollback function in case of failure
rollback() {
    echo -e "${RED}Deployment failed. Rolling back...${NC}"
    ssh_exec "cd $DEPLOY_PATH/.. && tar -xzf backup_$(ls -t backup_* | head -1).tar.gz -C $DEPLOY_PATH"
    ssh_exec "sudo systemctl restart nginx"
    ssh_exec "sudo systemctl restart php-fpm"
    echo -e "${YELLOW}Rollback completed${NC}"
}

# Call rollback if deployment fails
# trap rollback ERR