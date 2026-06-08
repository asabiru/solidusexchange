import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

time.sleep(3)

commands = [
    'tail -n 20 /root/p2c-sniper-bot/logs/bot_stdout.log',
    'tail -n 20 /root/p2c-sniper-bot/logs/sniper.log',
    'ps aux | grep python3 main.py | grep -v grep',
]

for cmd in commands:
    print(f'\n=== {cmd} ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode()
    if out.strip():
        print(out)
    else:
        print('(empty)')

ssh.close()
