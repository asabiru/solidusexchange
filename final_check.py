import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

time.sleep(2)

commands = [
    "ps aux | grep 'venv/bin/python3 main.py' | grep -v grep",
    "tail -n 5 /root/p2c-sniper-bot/logs/bot_stdout.log",
    "python3 -c \"data=open('/root/p2c-sniper-bot/logs/sniper.log','rb').read(); print(repr(data[-300:]))\"",
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
