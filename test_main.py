import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

# Kill existing bot and start fresh with explicit logging
stdin, stdout, stderr = ssh.exec_command(
    'cd /root/p2c-sniper-bot && '
    'pkill -f "python3 main.py" && sleep 2 && '
    'venv/bin/python3 main.py > /tmp/bot_test.log 2>&1 & '
    'echo $!'
)
pid = stdout.read().decode().strip()
print(f'New PID: {pid}')

import time
time.sleep(5)

# Check test log
stdin, stdout, stderr = ssh.exec_command('cat /tmp/bot_test.log')
print('=== /tmp/bot_test.log ===')
print(stdout.read().decode())

# Check if process still alive
stdin, stdout, stderr = ssh.exec_command(f'ps -p {pid} -o pid,comm,etime || echo DEAD')
print('=== process status ===')
print(stdout.read().decode())

ssh.close()
