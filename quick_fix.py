import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

# Kill all main.py processes
ssh.exec_command('kill -9 $(pgrep -f "main.py") 2>/dev/null')

import time
time.sleep(3)

# Start one fresh instance
ssh.exec_command(
    'cd /root/p2c-sniper-bot && nohup venv/bin/python3 -u main.py > logs/bot_stdout.log 2>&1 &'
)
time.sleep(3)

stdin, stdout, stderr = ssh.exec_command('pgrep -f "venv/bin/python3 -u main.py"')
print('PID:', stdout.read().decode().strip())

ssh.close()
