import paramiko

host = '82.27.201.169'
port = 22
username = 'root'
password = '09087691aA!'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=username, password=password,
            look_for_keys=False, allow_agent=False, timeout=15)

# Kill ALL python main.py processes
stdin, stdout, stderr = ssh.exec_command(
    'pgrep -f "main.py" | xargs -r kill -9 2>/dev/null; echo "Killed"'
)
print('Kill result:', stdout.read().decode().strip())

import time
time.sleep(2)

# Verify no more main.py processes
stdin, stdout, stderr = ssh.exec_command('pgrep -c -f "main.py" || echo 0')
count = stdout.read().decode().strip()
print('Remaining main.py processes:', count)

# Start fresh single instance
stdin, stdout, stderr = ssh.exec_command(
    'cd /root/p2c-sniper-bot && '
    'nohup venv/bin/python3 -u main.py > logs/bot_stdout.log 2>&1 & '
    'sleep 2 && pgrep -f "venv/bin/python3 -u main.py"'
)
out = stdout.read().decode().strip()
print('New PID:', out)

# Give it time to start
time.sleep(5)

# Check logs for TelegramConflictError
stdin, stdout, stderr = ssh.exec_command(
    'tail -n 20 /root/p2c-sniper-bot/logs/bot_stdout.log'
)
print('=== bot_stdout.log ===')
print(stdout.read().decode())

ssh.close()
