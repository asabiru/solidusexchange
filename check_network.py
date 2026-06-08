import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    "ping -c 5 app.send.tg 2>&1 | tail -3",
    "curl -s ipinfo.io/$(curl -s ifconfig.me) 2>/dev/null | head -20",
    "hostname && cat /etc/hostname 2>/dev/null",
]

for cmd in commands:
    print(f'\n=== {cmd} ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode()
    if out.strip():
        print(out)

ssh.close()