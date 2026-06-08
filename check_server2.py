import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    'ps aux | grep -i python | grep -v grep',
    'tail -n 100 /root/p2c-sniper-bot/logs/sniper.log',
    'cat /root/p2c-sniper-bot/.env',
    'systemctl status p2c-sniper-bot 2>/dev/null || echo no systemd',
    'screen -ls 2>/dev/null || echo no screen',
]

for cmd in commands:
    print(f'\n=== {cmd} ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode()
    if out.strip():
        print(out)
    err = stderr.read().decode()
    if err.strip():
        print('ERR:', err)

ssh.close()
