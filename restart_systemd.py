import paramiko
import time

host = '82.27.201.169'
port = 22
username = 'root'
password = '09087691aA!'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=username, password=password,
            look_for_keys=False, allow_agent=False, timeout=15)

# 1. Kill any stray processes
ssh.exec_command("ps aux | grep '[m]ain.py' | awk '{print $2}' | xargs -r kill -9 2>/dev/null")
time.sleep(2)

# 2. Stop systemd service
ssh.exec_command('systemctl stop sniper-bot.service')
time.sleep(2)

# 3. Restart via systemd
ssh.exec_command('systemctl restart sniper-bot.service')
time.sleep(5)

# 4. Check status
stdin, stdout, stderr = ssh.exec_command('systemctl is-active sniper-bot.service')
print('Service status:', stdout.read().decode().strip())

# 5. Check only one process
stdin, stdout, stderr = ssh.exec_command("ps aux | grep '[m]ain.py' | grep python | grep -v grep")
out = stdout.read().decode().strip()
print('Bot processes:')
print(out if out else 'None')

# 6. Check logs for conflicts
stdin, stdout, stderr = ssh.exec_command(
    'journalctl -u sniper-bot.service --no-pager -n 20 2>/dev/null || '
    'tail -n 20 /root/p2c-sniper-bot/logs/bot_stdout.log'
)
print('\n=== Recent logs ===')
print(stdout.read().decode())

ssh.close()
