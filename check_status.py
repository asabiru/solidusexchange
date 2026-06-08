import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    "ps aux | grep main.py | grep -v grep",
    "ls -la /root/p2c-sniper-bot/nohup.out /root/nohup.out 2>/dev/null || echo no nohup.out",
    "tail -n 30 /root/p2c-sniper-bot/logs/sniper.log",
    "tail -n 30 /root/p2c-sniper-bot/logs/bot_stdout.log",
    "cat /root/p2c-sniper-bot/.env | grep BOT_TOKEN",
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
