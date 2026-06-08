import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

stdin, stdout, stderr = ssh.exec_command(
    'journalctl -u sniper-bot.service --no-pager -n 60 --since "5 min ago" 2>/dev/null || '
    'tail -n 60 /root/p2c-sniper-bot/logs/bot_stdout.log'
)
out = stdout.read().decode()
print(out if out else '(empty)')

ssh.close()