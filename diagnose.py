import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    "journalctl -u sniper-bot.service --no-pager -n 40 2>/dev/null || tail -n 40 /root/p2c-sniper-bot/logs/bot_stdout.log",
    "python3 -c \"data=open('/root/p2c-sniper-bot/logs/sniper.log','rb').read(); print(repr(data[-1000:]))\"",
    "cd /root/p2c-sniper-bot && venv/bin/python3 -c \"import database; import asyncio; asyncio.run(database.db.connect()); users = asyncio.run(database.db.get_all_users()); print('Users:', users[:3] if users else 'none'); tokens = asyncio.run(database.db.get_all_tokens()); print('Tokens:', tokens[:3] if tokens else 'none'); asyncio.run(database.db.close())\"",
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