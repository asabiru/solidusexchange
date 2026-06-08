import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    'tail -n 100 /root/p2c-sniper-bot/logs/sniper.log | grep -i error',
    'tail -n 100 /root/p2c-sniper-bot/logs/sniper.log | grep -i "cannot unpack"',
    'tail -n 100 /root/p2c-sniper-bot/logs/sniper.log | grep -i "died"',
    'tail -n 50 /root/p2c-sniper-bot/logs/bot_stdout.log',
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
