import paramiko

host = '82.27.201.169'
port = 22
username = 'root'
password = '09087691aA!'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=username, password=password,
            look_for_keys=False, allow_agent=False, timeout=15)

sftp = ssh.open_sftp()

sftp.put(
    r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot\main.py',
    '/root/p2c-sniper-bot/main.py'
)
print('Uploaded main.py')

sftp.put(
    r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot\sniper.py',
    '/root/p2c-sniper-bot/sniper.py'
)
print('Uploaded sniper.py')

sftp.close()

# Kill any existing bot processes carefully (avoid killing the timeout or nohup itself)
stdin, stdout, stderr = ssh.exec_command(
    'pgrep -f "venv/bin/python3 main.py" | xargs -r kill -9 2>/dev/null; echo "killed"'
)
print('Kill result:', stdout.read().decode().strip())

# Start bot with nohup properly
stdin, stdout, stderr = ssh.exec_command(
    'cd /root/p2c-sniper-bot && '
    'nohup venv/bin/python3 -u main.py > logs/bot_stdout.log 2>&1 & '
    'sleep 1 && pgrep -f "venv/bin/python3 main.py"'
)
out = stdout.read().decode().strip()
print('New PID(s):', out)

ssh.close()
