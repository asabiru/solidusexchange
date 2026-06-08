import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

time.sleep(10)

commands = [
    "ps -p 212351 -o pid,comm,etime || echo DEAD",
    "tail -n 30 /root/p2c-sniper-bot/logs/sniper.log",
    "wc -l /root/p2c-sniper-bot/logs/sniper.log",
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
