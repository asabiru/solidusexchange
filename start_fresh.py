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

# Start ONE fresh instance using setsid to detach completely from SSH session
ssh.exec_command(
    "cd /root/p2c-sniper-bot && setsid venv/bin/python3 -u main.py > logs/bot_stdout.log 2>&1 &"
)
time.sleep(4)

# Verify only ONE python process for main.py
stdin, stdout, stderr = ssh.exec_command(
    "ps aux | grep '[m]ain.py' | grep python | grep -v grep"
)
out = stdout.read().decode().strip()
print('Running bot processes:')
print(out if out else 'None')

# Check recent logs for conflicts
stdin, stdout, stderr = ssh.exec_command(
    "tail -n 15 /root/p2c-sniper-bot/logs/bot_stdout.log"
)
print('\n=== bot_stdout.log (last 15 lines) ===')
print(stdout.read().decode())

ssh.close()
