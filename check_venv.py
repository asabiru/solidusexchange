import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    '/root/p2c-sniper-bot/venv/bin/pip list | grep -i aiohttp',
    '/root/p2c-sniper-bot/venv/bin/pip list | grep -i aiogram',
    '/root/p2c-sniper-bot/venv/bin/python --version',
    'ls -la /root/p2c-sniper-bot/logs/',
    'wc -l /root/p2c-sniper-bot/logs/sniper.log',
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
