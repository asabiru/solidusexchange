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

# Kill ALL python processes in the bot directory
stdin, stdout, stderr = ssh.exec_command(
    "pgrep -f '/root/p2c-sniper-bot.*python' | xargs -r kill -9 2>/dev/null; echo 'Killed'"
)
print('Kill:', stdout.read().decode().strip())

time.sleep(3)

# Verify nothing left
stdin, stdout, stderr = ssh.exec_command(
    "ps aux | grep '/root/p2c-sniper-bot' | grep python | grep -v grep || echo 'None'"
)
print('Remaining:', stdout.read().decode().strip())

# Start fresh single instance using a simple approach
stdin, stdout, stderr = ssh.exec_command(
    "cd /root/p2c-sniper-bot && nohup venv/bin/python3 -u main.py > logs/bot_stdout.log 2>&1 &"
)
print('Start command sent')

time.sleep(3)

# Check PID (exclude the bash/nohup shell itself by matching exact python binary)
stdin, stdout, stderr = ssh.exec_command(
    "ps aux | grep 'venv/bin/python3' | grep 'main.py' | grep -v grep"
)
out = stdout.read().decode().strip()
print('Running processes:')
print(out if out else 'None')

ssh.close()
