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
sftp.put(
    r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot\sniper.py',
    '/root/p2c-sniper-bot/sniper.py'
)
sftp.close()

# Kill old bot and start new one
ssh.exec_command('pkill -f "venv/bin/python3 main.py"')
import time
time.sleep(2)

ssh.exec_command(
    'cd /root/p2c-sniper-bot && '
    'nohup venv/bin/python3 -u main.py > logs/bot_stdout.log 2>&1 &'
)
time.sleep(3)

stdin, stdout, stderr = ssh.exec_command('pgrep -f "venv/bin/python3 main.py"')
print('PID:', stdout.read().decode().strip())

ssh.close()
